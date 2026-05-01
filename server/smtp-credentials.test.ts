import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

describe("SMTP Credentials Validation", () => {
  it("should connect to Gmail SMTP with the new credentials", async () => {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("SKIP: SMTP credentials not configured in this environment");
      return;
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    const result = await transporter.verify();
    expect(result).toBe(true);
  }, 15000);
});
