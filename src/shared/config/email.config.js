import nodemailer from 'nodemailer';

export const transporter = nodemailer.createTransport({
  host: "outlook.office365.com",
  secureConnection: false,
  port: 587,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


