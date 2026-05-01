/**
 * sendOnboardingCompleteEmail.ts
 *
 * Sent once when a distributor finishes the onboarding wizard
 * (onboarding.saveOnboarding flips onboardingCompleted from false → true).
 *
 * Distinct from the signup welcome email: this one recaps the answers
 * the distributor just gave and recommends the next high-leverage actions.
 *
 * Uses the same Lane-1 (MergeTasks-branded) Resend pipeline as every other
 * platform email so ops infrastructure remains consistent.
 */
import { sendEmail } from "./mailer";
import { buildOnboardingCompleteEmail } from "./emailTemplateOnboardingComplete";
import { getLogger } from "../utils/logger";

const log = getLogger("onboarding-complete-email");

export interface SendOnboardingCompleteEmailOpts {
  distributorEmail: string;
  firstName: string;
  companyName?: string;
  dashboardUrl: string;
  summary?: {
    companySize?: string;
    primaryGoal?: string;
    specialties?: string[];
    topCategories?: string[];
    targetIndustries?: string[];
  };
}

export async function sendOnboardingCompleteEmail(
  opts: SendOnboardingCompleteEmailOpts,
): Promise<{ sent: boolean; error?: string }> {
  const { subject, html } = buildOnboardingCompleteEmail({
    firstName: opts.firstName,
    companyName: opts.companyName,
    dashboardUrl: opts.dashboardUrl,
    summary: opts.summary,
  });

  log.info(
    `Sending onboarding-complete email to ${opts.distributorEmail} ` +
    `(${opts.firstName}${opts.companyName ? ` / ${opts.companyName}` : ""})`,
  );

  const result = await sendEmail(
    opts.distributorEmail,
    subject,
    html,
    "MergeTasks", // Lane 1
  );

  if (!result.sent) {
    log.warn(
      `Onboarding-complete email delivery failed for ${opts.distributorEmail}: ${result.error}`,
    );
  }

  return result;
}
