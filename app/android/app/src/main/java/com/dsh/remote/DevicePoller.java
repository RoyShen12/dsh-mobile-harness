package com.dsh.remote;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The phone half of the device channel ("phone as hands", P1 = status only).
 *
 * While the app is running it holds one long poll open against the gateway:
 * {@code POST /__device/poll} answers a command immediately, or 204 after {@code waitMs} of quiet.
 * Each command is executed here and reported back with {@code POST /__device/result}.
 *
 * Rules that keep this safe:
 *   - the token is the only credential and lives in memory only — never on disk, never logged;
 *   - the channel is optional on the host: a 403 (switch off) just slows the loop down instead of
 *     killing it, so the owner can flip the switch without the phone reconnecting;
 *   - a 401 means the token was revoked: the loop stops, and nothing is retried with it — the
 *     listener is told instead, so the activity can ask the gateway for a fresh token.
 */
final class DevicePoller {

    /** Told when the gateway rejects the token, so the activity can mint a new one with backoff. */
    interface Listener {
        void onTokenRejected();
    }

    private static final String TAG = "DshDevicePoll";
    /** Slightly under the gateway's 30 s read timeout. */
    private static final int POLL_WAIT_MS = 25000;
    private static final int SLEEP_AFTER_ERROR_MS = 5000;
    private static final int SLEEP_WHILE_DISABLED_MS = 30000;

    private final Context context;
    private volatile boolean running = false;
    private volatile String base = "";
    private volatile String token = "";
    private volatile String installationId = "";
    private volatile Listener listener;
    private Thread thread;

    DevicePoller(Context context) {
        this(context, null);
    }

    DevicePoller(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    /** Starts (or restarts) the loop for one gateway and one fresh token. */
    synchronized void start(String gatewayBase, String deviceToken, String installId) {
        stop();
        if (gatewayBase == null || gatewayBase.isEmpty() || deviceToken == null || deviceToken.isEmpty()) return;
        base = gatewayBase.endsWith("/") ? gatewayBase : gatewayBase + "/";
        token = deviceToken;
        installationId = installId == null ? "" : installId;
        running = true;
        thread = new Thread(this::loop, "dsh-device-poll");
        thread.setDaemon(true);
        thread.start();
    }

    boolean isRunning() {
        return running;
    }

    synchronized void stop() {
        running = false;
        token = "";
        Thread current = thread;
        thread = null;
        if (current != null) current.interrupt();
    }

    private void loop() {
        while (running) {
            try {
                Reply reply = post("__device/poll", new JSONObject().put("waitMs", POLL_WAIT_MS).toString());
                if (!running) return;
                if (reply.status == 200) {
                    JSONObject command = new JSONObject(reply.body).optJSONObject("cmd");
                    if (command != null) runCommand(command);
                    continue;
                }
                if (reply.status == 204) continue;
                if (reply.status == 401) {
                    // Token revoked, or the host restarted and lost it: stop this loop and let the
                    // activity ask for a new token (with backoff). Never retry with a dead token.
                    Log.i(TAG, "device token rejected (401), stopping");
                    stop();
                    Listener notify = listener;
                    if (notify != null) notify.onTokenRejected();
                    return;
                }
                if (reply.status == 403) {
                    sleep(SLEEP_WHILE_DISABLED_MS);
                    continue;
                }
                sleep(SLEEP_AFTER_ERROR_MS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception error) {
                if (!running) return;
                Log.i(TAG, "poll failed: " + error.getClass().getSimpleName());
                sleep(SLEEP_AFTER_ERROR_MS);
            }
        }
    }

    /** Execute one command and always report an outcome, so the caller never hangs. */
    private void runCommand(JSONObject command) {
        String id = command.optString("id", "");
        String op = command.optString("op", "");
        if (id.isEmpty()) return;
        long started = System.currentTimeMillis();
        JSONObject result = new JSONObject();
        try {
            JSONObject data;
            if ("status".equals(op)) {
                data = status();
            } else {
                JSONObject args = command.optJSONObject("args");
                data = DshAgentService.execute(op, args == null ? new JSONObject() : args);
            }
            result.put("ok", true);
            result.put("data", data);
        } catch (DshAgentService.AgentError error) {
            // Refusals carry a code the computer shows verbatim: not_accessible, device_locked,
            // stale_snapshot, bad_target, blocked_by_policy, confirm_required, not_found.
            try {
                result.put("ok", false);
                result.put("error", error.getMessage());
                result.put("code", error.code);
            } catch (Exception ignored) {
                // JSONObject never throws for these keys on any supported API level.
            }
        } catch (Exception error) {
            try {
                result.put("ok", false);
                result.put("error", error.getMessage() == null ? "手机执行失败" : error.getMessage());
            } catch (Exception ignored) {
                // JSONObject never throws for these keys on any supported API level.
            }
        }
        try {
            result.put("id", id);
            result.put("ms", System.currentTimeMillis() - started);
        } catch (Exception ignored) {
            // Keep the loop alive even if a field could not be written.
        }
        try {
            post("__device/result", result.toString());
        } catch (Exception error) {
            Log.i(TAG, "result post failed: " + error.getClass().getSimpleName());
        }
    }

    /** The facts only the phone knows; all of them are cheap and need no runtime permission. */
    private JSONObject status() throws Exception {
        JSONObject data = new JSONObject();
        BatteryManager battery = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
        if (battery != null) {
            int level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            if (level >= 0) data.put("battery", level);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) data.put("charging", battery.isCharging());
        }
        data.put("network", networkLabel());
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            data.put("screenOn", power.isInteractive());
        }
        KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguard != null) data.put("locked", keyguard.isKeyguardLocked());
        data.put("foregroundApp", appStateLabel());
        data.put("appVersion", appVersion());
        data.put("sdk", Build.VERSION.SDK_INT);
        return data;
    }

    private String networkLabel() {
        try {
            ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (manager == null) return "";
            Network active = manager.getActiveNetwork();
            if (active == null) return "离线";
            NetworkCapabilities caps = manager.getNetworkCapabilities(active);
            if (caps == null) return "离线";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "Wi-Fi";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "移动网络";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "有线";
            return "其他网络";
        } catch (Exception error) {
            return "";
        }
    }

    /** Whether this app itself is in the foreground (no usage-access permission needed). */
    private String appStateLabel() {
        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) return "";
            for (ActivityManager.RunningAppProcessInfo info : manager.getRunningAppProcesses()) {
                if (info.pid != android.os.Process.myPid()) continue;
                return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                        ? "Mobile Harness（前台）"
                        : "Mobile Harness（后台）";
            }
        } catch (Exception ignored) {
            // Fall through: the caller simply gets no foreground hint.
        }
        return "";
    }

    private String appVersion() {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            return "";
        }
    }

    private static final class Reply {
        final int status;
        final String body;

        Reply(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    /** One POST through platform TLS validation and the allowed gateway URL rules. */
    private Reply post(String path, String payload) throws Exception {
        URL url = new URL(base + path);
        if (!MainActivity.isTunnelUrl(url)) throw new Exception("host or transport not allowed");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(POLL_WAIT_MS + 10000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("X-DSH-Client", "app");
        connection.setRequestProperty("X-DSH-Client-Id", installationId);
        connection.setRequestProperty("X-DSH-Device-Token", token);
        byte[] body = (payload == null ? "{}" : payload).getBytes(StandardCharsets.UTF_8);
        try (OutputStream stream = connection.getOutputStream()) {
            stream.write(body);
        }
        int status = connection.getResponseCode();
        String text = readAll(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        connection.disconnect();
        return new Reply(status, text);
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder text = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) text.append(line);
        return text.toString();
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            running = false;
        }
    }
}
