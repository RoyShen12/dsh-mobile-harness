package com.dsh.remote;

import java.util.Locale;

/**
 * The hard limits the model cannot talk its way past. Money apps are never driven, and a row whose
 * label smells like payment needs the person to say yes first even inside an allowed app.
 */
final class AgentGuard {

    /** Apps that move money, change the phone's own safety settings, or hold passwords. */
    private static final String[] BLOCKED_PACKAGES = {
            "com.eg.android.alipaygphone",
            "com.unionpay",
            "com.icbc",
            "com.chinamworld",
            "com.cmbchina",
            "cmb.pb",
            "com.android.bankabc",
            "com.bankcomm",
            "com.spdb",
            "com.ecitic",
            "com.tencent.mm",
            "com.tencent.mobileqq",
            "com.jd.jrapp",
            "com.android.settings",
            "com.agilebits.onepassword",
            "com.onepassword.android",
            "com.lastpass.lpandroid",
            "com.x8bit.bitwarden",
    };

    /** Words that make a tap a decision only the person may take. */
    private static final String[] RISKY_WORDS = {
            "\u8f6c\u8d26",   // 转账
            "\u4ed8\u6b3e",   // 付款
            "\u652f\u4ed8",   // 支付
            "\u9a8c\u8bc1\u7801", // 验证码
            "\u6388\u6743",   // 授权
            "\u514d\u5bc6",   // 免密
            "\u63d0\u73b0",   // 提现
            "\u6c47\u6b3e",   // 汇款
            "\u6536\u6b3e",   // 收款
            "\u7ea2\u5305",   // 红包
            "\u8f49\u5e33",
            "\u4ed8\u6b3e",
            "\u652f\u4ed8",
            "\u9a57\u8b49\u78bc",
            "\u6388\u6b0a",
            "\u63d0\u73fe",
            "\u532f\u6b3e",
            "\u6536\u6b3e",
            "\u7d05\u5305",
            "transfer",
            "payment",
            "pay now",
            "verification code",
            "one-time password",
            "withdraw",
            "wire transfer",
            "authorize payment"
    };

    private AgentGuard() {
    }

    static boolean blockedPackage(String pkg) {
        if (pkg == null || !isPackageName(pkg)) return true;
        String lower = pkg.toLowerCase(Locale.ROOT);
        for (String blocked : BLOCKED_PACKAGES) {
            if (lower.equals(blocked) || lower.startsWith(blocked + ".")) return true;
        }
        return false;
    }

    static boolean isPackageName(String pkg) {
        return pkg != null && pkg.matches("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+");
    }

    static boolean riskyText(String text) {
        if (text == null || text.isEmpty()) return false;
        String normalized = text.toLowerCase(Locale.ROOT);
        for (String word : RISKY_WORDS) {
            if (normalized.contains(word.toLowerCase(Locale.ROOT))) return true;
        }
        return false;
    }
}
