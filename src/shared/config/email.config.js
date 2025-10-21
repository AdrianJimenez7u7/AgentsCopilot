import nodemailer from 'nodemailer';

export const transporter = nodemailer.createTransport({
  host: "outlook.office365.com",
  secureConnection: false,
  port: 587,
  auth: {
    user: "transformacion.digital@compucad.com.mx",
    pass: "T.D.2223#"
  }
});


