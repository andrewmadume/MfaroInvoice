type AuthFailure = { code?: string; status?: number };

export function registrationErrorCode(error: AuthFailure): string {
  if (error.code === "over_email_send_rate_limit") return "email-rate-limited";
  if (error.code === "email_address_not_authorized") return "email-delivery-unavailable";
  if (error.code === "email_address_invalid") return "invalid-email";
  if (error.code === "weak_password") return "weak-password";
  if (error.code === "signup_disabled") return "signup-disabled";
  if (error.status === 429) return "too-many-attempts";
  return "registration-failed";
}

const messages: Record<string, string> = {
  "email-rate-limited": "Confirmation emails are temporarily rate limited. Please wait before trying again. If this continues, contact support so we can restore email delivery.",
  "email-delivery-unavailable": "Confirmation email delivery is not available for this address yet. Please contact support.",
  "invalid-email": "Please enter a valid email address that can receive confirmation emails.",
  "weak-password": "Please choose a stronger password with at least 12 characters.",
  "signup-disabled": "New account registration is currently unavailable. Please contact support.",
  "too-many-attempts": "Too many registration attempts. Please wait before trying again.",
  "invalid-registration": "Enter a business name of 2–160 characters, a valid email address, and a password of 12–1024 characters.",
};

export function registrationErrorMessage(code: string): string {
  return Object.hasOwn(messages, code) ? messages[code] : "We could not create the account. Please try again later or contact support.";
}
