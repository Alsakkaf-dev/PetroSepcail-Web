// FR-PC06-002: "Every notification type has an AR and EN template; the
// recipient's locale selects it. No user-facing notification ships in one
// language only." One registry entry per notification `type` (the same
// string stored in core.notifications.type / passed to notification_log).
export type NotificationType = "email_verify" | "password_reset" | "identity_welcome";

interface Template {
  subject: (params: Record<string, string>) => string;
  body: (params: Record<string, string>) => string;
}

const TEMPLATES: Record<NotificationType, Record<"ar" | "en", Template>> = {
  email_verify: {
    ar: {
      subject: () => "تفعيل حسابك في بتروسبيشل",
      body: (p) => `مرحباً،\n\nيرجى تفعيل حسابك عبر الرابط التالي:\n${p.verifyLink}\n\nإذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة.`
    },
    en: {
      subject: () => "Verify your PetroSpecial account",
      body: (p) => `Hello,\n\nPlease verify your account using the link below:\n${p.verifyLink}\n\nIf you did not create this account, you can ignore this email.`
    }
  },
  password_reset: {
    ar: {
      subject: () => "إعادة تعيين كلمة المرور",
      body: (p) => `مرحباً،\n\nلإعادة تعيين كلمة المرور الخاصة بك، استخدم الرابط التالي:\n${p.resetLink}\n\nصالح لمدة 30 دقيقة. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.`
    },
    en: {
      subject: () => "Reset your password",
      body: (p) => `Hello,\n\nUse the link below to reset your password:\n${p.resetLink}\n\nValid for 30 minutes. If you didn't request this, you can ignore this email.`
    }
  },
  identity_welcome: {
    ar: {
      subject: () => "أهلاً بك في بتروسبيشل",
      body: () => "تم تفعيل حسابك بنجاح. أهلاً بك في بتروسبيشل!"
    },
    en: {
      subject: () => "Welcome to PetroSpecial",
      body: () => "Your account is now active. Welcome to PetroSpecial!"
    }
  }
};

export function renderTemplate(
  type: NotificationType,
  locale: "ar" | "en",
  params: Record<string, string> = {}
): { subject: string; body: string } {
  const template = TEMPLATES[type][locale];
  return { subject: template.subject(params), body: template.body(params) };
}
