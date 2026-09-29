import nodemailer from 'nodemailer';
import type { Config } from './config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** What the mail is for — lets tests and logs distinguish mails without parsing text. */
  kind: 'signin' | 'confirm';
  /** The sign-in / confirmation link contained in the text. */
  link: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Real mailer chosen from config:
 *  - SMTP_URL set → nodemailer SMTP transport.
 *  - dev without SMTP → print the whole mail (including the link) to the console.
 *  - production without SMTP → log a redacted notice only; never tokens, links or addresses.
 */
export function createMailer(config: Pick<Config, 'smtpUrl' | 'mailFrom' | 'isProduction'>): Mailer {
  if (config.smtpUrl) {
    const transport = nodemailer.createTransport(config.smtpUrl);
    return {
      async send(mail) {
        await transport.sendMail({ from: config.mailFrom, to: mail.to, subject: mail.subject, text: mail.text });
      },
    };
  }
  if (config.isProduction) {
    return {
      async send(mail) {
        console.warn(`[mail] email disabled, would send "${mail.kind}" mail to <redacted>`);
      },
    };
  }
  return {
    async send(mail) {
      console.log(
        `\n[mail:dev] ---------------------------------------------\n` +
          `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n` +
          `[mail:dev] ---------------------------------------------\n`,
      );
    },
  };
}
