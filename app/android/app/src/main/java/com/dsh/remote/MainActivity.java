package com.dsh.remote;

import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Thin Capacitor shell for the DeepSeek Harness remote UI.
 *
 * The tunnel (SakuraFrp) terminates TLS with an automatically generated certificate, so the
 * WebView's default client would block the page. We keep Capacitor's client behavior and only
 * override SSL errors for an allow-list of tunnel hosts; everything else is still rejected.
 */
public class MainActivity extends BridgeActivity {

    private long lastRootBackAt = 0;
    private DownloadCenter downloads;
    private DevicePoller devicePoller;
    private AppSettingsBridge appBridge;

    /** Gateway base of the current page session; the channel is re-minted against it. */
    private volatile String channelBase = null;
    private volatile boolean tokenRequestInFlight = false;
    private int channelRetryStep = 0;
    /** 15 s → 30 s → 1 min → 2 min → 5 min. Only ever runs while the phone channel is down. */
    private static final long[] CHANNEL_RETRY_MS = {15000L, 30000L, 60000L, 120000L, 300000L};
    private final Handler channelRetryHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Make sure the WebView owns the IME: without this, taps can focus an input while the
        // soft keyboard never appears on some ROMs (the first symptom users report is "can't type").
        getWindow().setSoftInputMode(
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                        | WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED);
        downloads = new DownloadCenter(this);
        // The phone-side half of the device channel: it only runs while this activity lives.
        devicePoller = new DevicePoller(this, this::onDeviceTokenRejected);
        Bridge bridge = getBridge();
        if (bridge != null) {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.setWebViewClient(new TunnelWebViewClient(bridge));
                webView.setFocusable(true);
                webView.setFocusableInTouchMode(true);
                webView.requestFocus(View.FOCUS_DOWN);
                // Tag every page request as coming from the Android client so the host can tell
                // app sessions apart from ordinary browsers.
                String userAgent = webView.getSettings().getUserAgentString();
                if (userAgent != null && !userAgent.contains("DSHRemote/")) {
                    webView.getSettings().setUserAgentString(userAgent + " DSHRemote/" + appVersion());
                }
                // The QR viewfinder needs getUserMedia(): DOM storage keeps the saved credentials,
                // and muted autoplay keeps the preview from being blocked by the gesture policy.
                webView.getSettings().setDomStorageEnabled(true);
                webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
                // Lets the remote UI reopen the local connection settings on demand.
                appBridge = new AppSettingsBridge();
                webView.addJavascriptInterface(appBridge, "DshApp");
                // Fallback for downloads the page hook could not intercept (window.open, blob:…):
                // run the same streaming path inside the page so the gateway cookie is used.
                webView.setDownloadListener((downloadUrl, pageUserAgent, contentDisposition, mimeType, contentLength) -> {
                    String url = downloadUrl;
                    if (url == null || url.isEmpty()) return;
                    String script = "(function(){var u=" + JSONObject.quote(url)
                            + ";var n=" + JSONObject.quote(filenameFromDisposition(contentDisposition))
                            + ";if(window.__dshFetchDownload){window.__dshFetchDownload(u,n)}"
                            + "else if(window.DshApp&&window.DshApp.nativeDownload){window.DshApp.nativeDownload(u,n)}})()";
                    webView.evaluateJavascript(script, null);
                });
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Returning to the app is the cheapest moment to restore the channel: reset the backoff
        // and try once, so a host restart never leaves the phone silently offline.
        channelRetryStep = 0;
        channelRetryHandler.removeCallbacksAndMessages(null);
        // The bridge owns the token handshake (it can POST with the app's headers and cookies).
        if (appBridge != null && devicePoller != null && !devicePoller.isRunning() && channelBase != null) {
            appBridge.ensureDeviceChannel(channelBase);
        }
    }

    @Override
    public void onDestroy() {
        channelRetryHandler.removeCallbacksAndMessages(null);
        if (devicePoller != null) devicePoller.stop();
        super.onDestroy();
    }

    /**
     * The host forgot our token (it restarted) or revoked it (device removed). Mint a new one,
     * backing off 15 s → 5 min, so a dead token never leaves the phone silently offline.
     */
    private void onDeviceTokenRejected() {
        runOnUiThread(() -> {
            channelRetryStep = 0;
            if (appBridge != null) appBridge.scheduleChannelRetry();
        });
    }

    @Override
    public void onBackPressed() {
        Bridge bridge = getBridge();
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            // Normal in-page navigation (session list, settings…): go back inside the web app.
            webView.goBack();
            return;
        }
        // At the app root the session should stay: a single back keeps the app in the background,
        // a quick second back opens the local connection settings (instead of silently navigating
        // away from the chat every time).
        long now = System.currentTimeMillis();
        if (now - lastRootBackAt < 1800) {
            lastRootBackAt = 0;
            loadConfigPage(true);
            return;
        }
        lastRootBackAt = now;
        android.widget.Toast.makeText(this, getString(R.string.app_name) + "：再按一次返回可修改连接", android.widget.Toast.LENGTH_SHORT).show();
    }

    /** Loads the local Capacitor configuration page, optionally bypassing auto-connect. */
    private void loadConfigPage(boolean showForm) {
        Bridge bridge = getBridge();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        String localUrl = bridge.getLocalUrl();
        if (localUrl == null) return;
        if (localUrl.endsWith("/")) localUrl = localUrl.substring(0, localUrl.length() - 1);
        webView.loadUrl(localUrl + "/" + (showForm ? "?config=1" : ""));
    }

    private String appVersionCache = null;

    private String appVersion() {
        if (appVersionCache != null) return appVersionCache;
        try {
            appVersionCache = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            appVersionCache = "unknown";
        }
        return appVersionCache;
    }

    /** Cached body of the download hook injected into every remote page. */
    private String downloadHookCache = null;

    private String downloadHook() {
        if (downloadHookCache != null) return downloadHookCache;
        try (InputStream stream = getAssets().open("public/download-hook.js")) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) > 0) buffer.write(chunk, 0, read);
            downloadHookCache = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            downloadHookCache = "";
        }
        return downloadHookCache;
    }

    /** Best-effort file name from a Content-Disposition header (RFC 5987 wins). */
    private static String filenameFromDisposition(String header) {
        if (header == null || header.isEmpty()) return "";
        java.util.regex.Matcher utf8 = java.util.regex.Pattern
                .compile("filename\\*=UTF-8''([^;]+)", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(header);
        if (utf8.find()) {
            try {
                return java.net.URLDecoder.decode(utf8.group(1).trim(), "UTF-8");
            } catch (Exception ignored) {
                return utf8.group(1).trim();
            }
        }
        java.util.regex.Matcher plain = java.util.regex.Pattern
                .compile("filename=\"?([^\";]+)\"?", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(header);
        return plain.find() ? plain.group(1).trim() : "";
    }

    /** Stable per-installation identifier: survives cookie/WebView data loss until uninstall. */
    private String installationId() {
        android.content.SharedPreferences prefs = getSharedPreferences("dsh-remote", MODE_PRIVATE);
        String id = prefs.getString("installationId", null);
        if (id == null || id.length() < 16) {
            id = java.util.UUID.randomUUID().toString();
            prefs.edit().putString("installationId", id).apply();
        }
        return id;
    }

    private final class AppSettingsBridge {
        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(() -> loadConfigPage(true));
        }

        /** Jumps to the system accessibility list so the user can switch the agent service on. */
        @JavascriptInterface
        public void openAgentSettings() {
            runOnUiThread(() -> {
                try {
                    android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {
                    // Some ROMs hide the list; 设置 → 无障碍 still finds it by hand.
                }
            });
        }

        /** "on" once the accessibility service is connected, "off" while it is not. */
        @JavascriptInterface
        public String agentState() {
            return DshAgentService.connected() ? "on" : "off";
        }

        // ── streamed downloads (see app/www/download-hook.js) ──────────────────

        /** Opens a sink for one file; the page then pushes base64 chunks into it. */
        @JavascriptInterface
        public String beginDownload(String name, String mime, long total) {
            return downloads == null ? "" : downloads.begin(name, mime, total);
        }

        @JavascriptInterface
        public void appendDownload(String id, String base64) {
            if (downloads != null) downloads.append(id, base64);
        }

        @JavascriptInterface
        public void finishDownload(String id) {
            if (downloads != null) downloads.finish(id);
        }

        @JavascriptInterface
        public void abortDownload(String id) {
            if (downloads != null) downloads.abort(id);
        }

        @JavascriptInterface
        public void downloadError(String message) {
            runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this, message, android.widget.Toast.LENGTH_LONG).show());
        }

        /** JSON array of finished downloads, newest first. */
        @JavascriptInterface
        public String listDownloads() {
            return downloads == null ? "[]" : downloads.listJson();
        }

        /** Native 「下载记录」 dialog: tap to open, long-press to delete. */
        @JavascriptInterface
        public void showDownloads() {
            if (downloads != null) downloads.show();
        }

        /** System DownloadManager fallback when the page cannot stream the bytes itself. */
        @JavascriptInterface
        public void nativeDownload(String url, String name) {
            if (downloads != null) downloads.nativeDownload(url, name);
        }

        /**
         * The last address + password the gateway accepted, kept natively so the form still
         * prefills after Android clears WebView storage (upgrade, "clear data", WebView reset).
         */
        private void rememberCredentials(String base, String password) {
            android.content.SharedPreferences prefs = getSharedPreferences("dsh-remote", MODE_PRIVATE);
            if (!prefs.getBoolean("lastRemember", true)) return;
            if (base == null || base.isEmpty()) return;
            prefs.edit()
                    .putString("lastBase", base)
                    .putString("lastPassword", password == null ? "" : password)
                    .apply();
        }

        /** JSON {url, password, auto} for the connection form; empty strings before the first success. */
        @JavascriptInterface
        public String loadCredentials() {
            android.content.SharedPreferences prefs = getSharedPreferences("dsh-remote", MODE_PRIVATE);
            JSONObject out = new JSONObject();
            try {
                out.put("url", prefs.getString("lastBase", ""));
                out.put("password", prefs.getString("lastPassword", ""));
                out.put("auto", prefs.getBoolean("lastAuto", true));
            } catch (Exception ignored) {
                // A missing preference is not an error: the form just starts empty.
            }
            return out.toString();
        }

        /** Mirrors the form's 「记住地址和密码」/「保持登录」 switches into the native store. */
        @JavascriptInterface
        public void saveCredentials(String base, String password, boolean remember, boolean auto) {
            android.content.SharedPreferences prefs = getSharedPreferences("dsh-remote", MODE_PRIVATE);
            if (!remember) {
                prefs.edit()
                        .remove("lastBase")
                        .remove("lastPassword")
                        .putBoolean("lastRemember", false)
                        .putBoolean("lastAuto", false)
                        .apply();
                return;
            }
            prefs.edit()
                    .putString("lastBase", base == null ? "" : base)
                    .putString("lastPassword", password == null ? "" : password)
                    .putBoolean("lastRemember", true)
                    .putBoolean("lastAuto", auto)
                    .apply();
        }

        /**
         * Verifies the access password against the gateway's JSON endpoint and, on success, writes
         * the session cookie into the WebView and loads the app directly. A wrong password never
         * opens any page: the config page just shows an inline error.
         */
        @JavascriptInterface
        public void connect(String base, String password) {
            connect(base, password, "");
        }

        /**
         * Same as {@link #connect(String, String)} but trades in the QR's one-time ticket, so a
         * scan works on a phone that never stored the password (0.5.6).
         */
        @JavascriptInterface
        public void connect(String base, String password, String ticket) {
            String target = base == null ? "" : base.trim();
            if (!target.endsWith("/")) target = target + "/";
            final String finalTarget = target;
            final String secret = password == null ? "" : password;
            final String code = ticket == null ? "" : ticket.trim();
            final String installation = installationId();
            new Thread(() -> verifyAndLoad(finalTarget, secret, code, installation)).start();
        }

        /** One HTTP POST to the gateway's JSON admission endpoints. */
        private final class VerifyResult {
            final int status;
            final String body;
            final Map<String, List<String>> headers;

            VerifyResult(int status, String body, Map<String, List<String>> headers) {
                this.status = status;
                this.body = body == null ? "" : body;
                this.headers = headers;
            }

            String code() {
                try {
                    String value = new JSONObject(body).optString("code", "");
                    return value.isEmpty() ? "failed" : value;
                } catch (Exception ignored) {
                    return "failed";
                }
            }
        }

        private String lastPassword() {
            return getSharedPreferences("dsh-remote", MODE_PRIVATE).getString("lastPassword", "");
        }

        private String readAll(InputStream stream) throws Exception {
            if (stream == null) return "";
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line);
            return text.toString();
        }

        private VerifyResult post(String base, String path, String payload, String installationId) throws Exception {
            URL url = new URL(base + path);
            if (!isTunnelHost(url.getHost())) throw new Exception("host not allowed");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            if (connection instanceof HttpsURLConnection) {
                HttpsURLConnection https = (HttpsURLConnection) connection;
                https.setSSLSocketFactory(trustAllContext().getSocketFactory());
                https.setHostnameVerifier((hostname, session) -> true);
            }
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("X-DSH-Client", "app");
            connection.setRequestProperty("X-DSH-Client-Version", appVersion());
            connection.setRequestProperty("X-DSH-Client-Id", installationId);
            // Reuse the persisted device cookie so re-login keeps the same device identity
            // instead of appearing as a brand new device in the management panel.
            String existingCookies = CookieManager.getInstance().getCookie(base);
            if (existingCookies != null && !existingCookies.isEmpty()) {
                connection.setRequestProperty("Cookie", existingCookies);
            }
            byte[] body = payload.getBytes(StandardCharsets.UTF_8);
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(body);
            }
            int status = connection.getResponseCode();
            String text = readAll(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
            Map<String, List<String>> headers = new java.util.LinkedHashMap<>();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                if (entry.getKey() == null) continue;
                headers.put(entry.getKey(), entry.getValue());
            }
            connection.disconnect();
            return new VerifyResult(status, text, headers);
        }

        /** Copy every Set-Cookie into the WebView jar (session + device identity). */
        private void storeCookies(String base, Map<String, List<String>> headers) {
            CookieManager manager = CookieManager.getInstance();
            manager.setAcceptCookie(true);
            for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                if (!entry.getKey().equalsIgnoreCase("Set-Cookie")) continue;
                for (String cookie : entry.getValue()) {
                    // Keep Max-Age/Expires/Path so the identity cookie stays persistent;
                    // SameSite is not needed for the native CookieManager copy.
                    String normalized = cookie.replaceAll("(?i);\\s*samesite=[^;]*", "").trim();
                    manager.setCookie(base, normalized);
                }
            }
            manager.flush();
        }

        /**
         * Asks the gateway for a device token and starts the phone channel.
         *
         * Silent by design: before the owner turns 「手机协助」 on the answer is 403, and on a
         * stale session it is 401 — neither is an error the user needs to see.
         */
        void ensureDeviceChannel(String base) {
            if (base == null || base.isEmpty()) return;
            channelBase = base.endsWith("/") ? base : base + "/";
            requestDeviceToken();
        }

        /** One token attempt; a failure arms the backoff instead of leaving the phone offline. */
        private void requestDeviceToken() {
            if (devicePoller == null || devicePoller.isRunning()) return;
            if (tokenRequestInFlight) return;
            final String target = channelBase;
            if (target == null || target.isEmpty()) return;
            tokenRequestInFlight = true;
            new Thread(() -> {
                boolean started = false;
                try {
                    VerifyResult result = post(target, "__device/token", "{}", installationId());
                    if (result.status == 200) {
                        String token = new JSONObject(result.body).optString("token", "");
                        if (!token.isEmpty()) {
                            devicePoller.start(target, token, installationId());
                            started = true;
                        }
                    }
                } catch (Exception ignored) {
                    // No channel is a normal state (old host, switch off, stale session).
                } finally {
                    tokenRequestInFlight = false;
                    final boolean ok = started;
                    runOnUiThread(() -> {
                        if (ok) {
                            channelRetryStep = 0;
                            channelRetryHandler.removeCallbacksAndMessages(null);
                        } else {
                            scheduleChannelRetry();
                        }
                    });
                }
            }, "dsh-device-token").start();
        }

        /** 15 s → 5 min between attempts; resets the moment a token arrives. */
        private void scheduleChannelRetry() {
            if (channelBase == null) return;
            if (devicePoller != null && devicePoller.isRunning()) return;
            channelRetryHandler.removeCallbacksAndMessages(null);
            int step = Math.min(channelRetryStep, CHANNEL_RETRY_MS.length - 1);
            long delay = CHANNEL_RETRY_MS[step];
            channelRetryStep = Math.min(channelRetryStep + 1, CHANNEL_RETRY_MS.length - 1);
            channelRetryHandler.postDelayed(this::requestDeviceToken, delay);
        }

        private void notifyPage(String script) {
            runOnUiThread(() -> {
                Bridge bridge = getBridge();
                WebView webView = bridge != null ? bridge.getWebView() : null;
                if (webView == null) return;
                webView.evaluateJavascript(script, null);
            });
        }

        /**
         * Password → admission. 200 enters, 202 means a first-time device is queued on the PC and
         * this thread keeps polling until the owner taps 允许/拒绝 (or the request expires).
         */
        private void verifyAndLoad(String base, String password, String ticket, String installationId) {
            String outcome = "failed";
            String requestId = "";
            String label = "";
            String pairCode = "";
            long expiresAt = 0;
            try {
                JSONObject request = new JSONObject().put("password", password);
                if (!ticket.isEmpty()) request.put("ticket", ticket);
                VerifyResult result = post(base, "__verify", request.toString(), installationId);
                if (result.status == 200) {
                    storeCookies(base, result.headers);
                    // A ticket login never sees the password: keep the one already stored instead of
                    // blanking it (the address is still worth remembering for auto-login).
                    rememberCredentials(base, password.isEmpty() ? lastPassword() : password);
                    ensureDeviceChannel(base);
                    outcome = "ok";
                } else if (result.status == 202) {
                    // The credential is already verified here: only the owner's decision is pending,
                    // so this is worth remembering for the next scan.
                    if (!password.isEmpty()) rememberCredentials(base, password);
                    JSONObject body = new JSONObject(result.body);
                    requestId = body.optString("requestId", "");
                    label = body.optString("label", "");
                    pairCode = body.optString("pairCode", "");
                    expiresAt = body.optLong("expiresAt", 0);
                    outcome = requestId.isEmpty() ? "failed" : "pending";
                } else {
                    outcome = result.code();
                }
            } catch (Exception error) {
                // "host not allowed" is a configuration mistake, not a wrong password: tell the
                // user which entries the app supports instead of blaming the password.
                String message = error.getMessage();
                outcome = message != null && message.contains("host not allowed") ? "host" : "failed";
            }
            if ("ok".equals(outcome)) {
                runOnUiThread(() -> {
                    Bridge bridge = getBridge();
                    WebView webView = bridge != null ? bridge.getWebView() : null;
                    if (webView != null) webView.loadUrl(base);
                });
                return;
            }
            if ("pending".equals(outcome)) {
                final String pendingLabel = label;
                final String pendingRequestId = requestId;
                final String pendingPairCode = pairCode;
                final long pendingUntil = expiresAt;
                notifyPage("window.__dshConnectPending && window.__dshConnectPending(" + JSONObject.quote(pendingLabel) + "," + pendingUntil + "," + JSONObject.quote(pendingPairCode) + ")");
                new Thread(() -> pollApproval(base, pendingRequestId, installationId, pendingUntil)).start();
                return;
            }
            final String reason = outcome;
            notifyPage("window.__dshConnectResult && window.__dshConnectResult(" + JSONObject.quote(reason) + ")");
        }

        /** Poll /__verify/status until the owner decides, the request expires or the device is banned. */
        private void pollApproval(String base, String requestId, String installationId, long expiresAt) {
            long deadline = expiresAt > 0 ? expiresAt : System.currentTimeMillis() + 5 * 60 * 1000;
            while (System.currentTimeMillis() < deadline) {
                try {
                    Thread.sleep(2000);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                }
                try {
                    VerifyResult result = post(base, "__verify/status", new JSONObject().put("requestId", requestId).toString(), installationId);
                    if (result.status == 200) {
                        storeCookies(base, result.headers);
                        ensureDeviceChannel(base);
                        runOnUiThread(() -> {
                            Bridge bridge = getBridge();
                            WebView webView = bridge != null ? bridge.getWebView() : null;
                            if (webView != null) webView.loadUrl(base);
                        });
                        return;
                    }
                    if (result.status == 403) {
                        final String reason = result.code();
                        notifyPage("window.__dshConnectResult && window.__dshConnectResult(" + JSONObject.quote(reason) + ")");
                        return;
                    }
                } catch (Exception ignored) {
                    // A transient network error must not lose the queue slot: keep polling.
                }
            }
            notifyPage("window.__dshConnectResult && window.__dshConnectResult(\"expired\")");
        }

        private SSLContext trustAllContext() throws Exception {
            TrustManager[] managers = new TrustManager[] {
                new X509TrustManager() {
                    public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                    public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                }
            };
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, managers, new java.security.SecureRandom());
            return context;
        }
    }

    /** Scheme + authority of a page URL, with a trailing slash (the gateway's own root). */
    private static String baseOf(String url) {
        try {
            URL parsed = new URL(url);
            String port = parsed.getPort() > 0 ? ":" + parsed.getPort() : "";
            return parsed.getProtocol() + "://" + parsed.getHost() + port + "/";
        } catch (Exception ignored) {
            return "";
        }
    }

    /**
     * Which hosts the app is allowed to talk to: the panel's four entries plus same-Wi-Fi.
     * Tailscale (*.ts.net), SakuraFrp/frp (frp-cat.com), Cloudflare quick tunnel
     * (*.trycloudflare.com, whose name changes on every restart) and the LAN address itself.
     */
    static boolean isTunnelHost(String host) {
        if (host == null) return false;
        String value = host.toLowerCase(Locale.ROOT);
        if (value.equals("localhost") || value.equals("127.0.0.1")) return true;
        if (value.equals("frp-cat.com") || value.endsWith(".frp-cat.com")) return true;
        if (value.endsWith(".ts.net")) return true;
        if (value.endsWith(".trycloudflare.com") || value.endsWith(".cfargotunnel.com")) return true;
        return isPrivateIpv4(value);
    }

    /** 10.x / 172.16-31.x / 192.168.x: no tunnel at all, phone and PC on the same Wi-Fi. */
    private static boolean isPrivateIpv4(String value) {
        String[] parts = value.split("\\.");
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            String part = parts[i];
            if (part.isEmpty() || part.length() > 3) return false;
            for (int c = 0; c < part.length(); c++) {
                if (part.charAt(c) < '0' || part.charAt(c) > '9') return false;
            }
            octets[i] = Integer.parseInt(part);
        }
        if (octets[0] == 10) return true;
        if (octets[0] == 192 && octets[1] == 168) return true;
        return octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31;
    }

    private final class TunnelWebViewClient extends BridgeWebViewClient {

        private String lastUrl = null;

        TunnelWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            // Remote pages only: the local configuration page needs no download interception.
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                String hook = downloadHook();
                if (!hook.isEmpty()) view.evaluateJavascript(hook, null);
                // A session restored from the cookie jar skips the admission POST, so the phone
                // channel is (re)started here too: the poller keeps running across page loads.
                if (appBridge != null && url.startsWith("https://") && !url.startsWith("https://localhost")) {
                    appBridge.ensureDeviceChannel(baseOf(url));
                }
            }
            // Once we leave the local configuration page for the remote UI, drop the local page
            // (and any old password page) from the back stack so "返回" cannot bounce back to a
            // login/configuration screen.
            if (lastUrl != null && lastUrl.startsWith("https://localhost") && !url.startsWith("https://localhost")) {
                view.clearHistory();
            }
            lastUrl = url;
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            // A revoked/kicked device (or blacklisted one) gets 403 from the gateway; send the user
            // back to the local configuration page so they can re-enter the access password.
            if (request.isForMainFrame() && errorResponse.getStatusCode() == 403) {
                String url = request.getUrl() != null ? request.getUrl().toString() : "";
                if (!url.startsWith("https://localhost")) {
                    loadConfigPage(true);
                }
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            String host = null;
            try {
                host = new URL(error.getUrl()).getHost();
            } catch (Exception ignored) {
                // fall through to cancel
            }
            if (isTunnelHost(host)) {
                handler.proceed();
            } else {
                handler.cancel();
            }
        }
    }
}
