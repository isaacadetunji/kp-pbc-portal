import "server-only";

export { emailConfig, getEmailProvider, type EmailMessage, type EmailProvider } from "./provider";
export { runDispatch, emailBrand, type DispatchSummary } from "./dispatch";
export { renderInstantEmail, renderReminderEmail, renderTestEmail, type EmailBrand } from "./templates";
