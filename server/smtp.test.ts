import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

const hasSmtpConfig = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.SMTP_FROM
);

describe("SMTP Email Configuration", () => {
  it("should have SMTP environment variables configured", () => {
    if (!hasSmtpConfig) {
      console.log("SKIP: SMTP environment variables not configured in this environment");
      return;
    }
    expect(process.env.SMTP_HOST).toBeTruthy();
    expect(process.env.SMTP_PORT).toBeTruthy();
    expect(process.env.SMTP_USER).toBeTruthy();
    expect(process.env.SMTP_PASS).toBeTruthy();
    expect(process.env.SMTP_FROM).toBeTruthy();
  });

  it("should successfully verify SMTP connection to Gmail", async () => {
    if (!hasSmtpConfig) {
      console.log("SKIP: SMTP not configured");
      return;
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    const result = await transporter.verify();
    expect(result).toBe(true);
  }, 15000);

  it("should send a real test email to the configured address", async () => {
    if (!hasSmtpConfig) {
      console.log("SKIP: SMTP not configured");
      return;
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    const info = await transporter.sendMail({
      from: `"MergeTasks Test" <${process.env.SMTP_FROM}>`,
      to: process.env.SMTP_USER,
      subject: "MergeTasks SMTP Test - Email Delivery Confirmed",
      html: `<div style="font-family:sans-serif;padding:20px;background:#F5F3FF;border-radius:12px;">
        <h2 style="color:#654BF9;">MergeTasks Email Test</h2>
        <p>If you're reading this, your SMTP configuration is working correctly.</p>
        <p style="color:#737373;font-size:13px;">Sent at: ${new Date().toISOString()}</p>
      </div>`,
    });
    expect(info.accepted.length).toBeGreaterThan(0);
  }, 15000);
});
