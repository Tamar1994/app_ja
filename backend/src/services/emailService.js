const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_REMETENTE,
    pass: process.env.SENHA_EMAIL,
  },
});

const logoUrl = (process.env.APP_URL || 'http://192.168.15.17:3000') + '/admin/logo.png';
const logoHtml = `<div style="text-align:center;margin-bottom:24px;"><img src="${logoUrl}" alt="Ja!" style="width:90px;height:90px;object-fit:contain;" /></div>`;

const sendVerificationEmail = async (email, name, code) => {
  await transporter.sendMail({
    from: `"Ja! Servicos" <${process.env.EMAIL_REMETENTE}>`,
    to: email,
    subject: 'Confirme seu e-mail - Ja!',
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f6fa;padding:32px;border-radius:16px;">${logoHtml}<h2 style="color:#1A1A2E;margin-bottom:8px;">Ola, ${name}!</h2><p style="color:#5C6B7A;margin-bottom:24px;">Use o codigo abaixo para confirmar seu e-mail. Expira em <strong>15 minutos</strong>.</p><div style="background:#fff;border-radius:12px;padding:24px;text-align:center;border:2px solid #FF6B00;margin-bottom:24px;"><span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#FF6B00;">${code}</span></div><p style="color:#A8B5C0;font-size:13px;">Se voce nao criou uma conta no Ja!, ignore este e-mail.</p></div>`,
  });
};

const sendApprovalEmail = async (email, name) => {
  await transporter.sendMail({
    from: `"Ja! Servicos" <${process.env.EMAIL_REMETENTE}>`,
    to: email,
    subject: 'Sua conta foi aprovada - Ja!',
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f6fa;padding:32px;border-radius:16px;">${logoHtml}<div style="background:#fff;border-radius:12px;padding:28px;text-align:center;margin-bottom:20px;border-top:4px solid #00C853;"><div style="font-size:48px;margin-bottom:12px;">&#127881;</div><h2 style="color:#1A1A2E;margin-bottom:8px;">Conta Aprovada!</h2><p style="color:#5C6B7A;">Parabens, <strong>${name}</strong>! Sua identidade foi verificada com sucesso.</p></div><p style="color:#5C6B7A;line-height:1.6;">Voce ja pode acessar o app e aproveitar todos os recursos da plataforma <strong>Ja!</strong>. Bem-vindo(a) a nossa comunidade!</p></div>`,
  });
};

const sendRejectionEmail = async (email, name, reason) => {
  await transporter.sendMail({
    from: `"Ja! Servicos" <${process.env.EMAIL_REMETENTE}>`,
    to: email,
    subject: 'Atualizacao sobre seu cadastro - Ja!',
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f6fa;padding:32px;border-radius:16px;">${logoHtml}<div style="background:#fff;border-radius:12px;padding:28px;margin-bottom:20px;border-top:4px solid #FF6B00;"><h2 style="color:#1A1A2E;margin-bottom:8px;">Ola, ${name}</h2><p style="color:#5C6B7A;line-height:1.6;">Apos analise, nao conseguimos aprovar seu cadastro neste momento.</p><div style="background:#fff8f5;border-radius:8px;padding:16px;border-left:4px solid #FF6B00;margin:16px 0;"><p style="color:#1A1A2E;margin:0;font-size:14px;"><strong>Motivo:</strong> ${reason}</p></div><p style="color:#5C6B7A;font-size:14px;">Voce pode tentar novamente apos corrigir o problema. Abra o app e envie novos documentos.</p></div></div>`,
  });
};

module.exports = { sendVerificationEmail, sendApprovalEmail, sendRejectionEmail };
