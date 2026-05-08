const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_REMETENTE || 'noreply@ja.app.br';
const FROM_NAME = `"Já! Serviços" <${FROM}>`;

const logoUrl = 'https://ja-backend-gpow.onrender.com/admin/logo.png';
const logoHtml = `<div style="text-align:center;margin-bottom:24px;"><img src="${logoUrl}" alt="Ja!" style="width:90px;height:90px;object-fit:contain;" /></div>`;

const sendMail = async ({ to, subject, html }) => {
  const { error } = await resend.emails.send({ from: FROM_NAME, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
};

const sendVerificationEmail = async (email, name, code) => {
  await sendMail({
    to: email,
    subject: 'Confirme seu e-mail - Já!',
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f6fa;padding:32px;border-radius:16px;">${logoHtml}<h2 style="color:#1A1A2E;margin-bottom:8px;">Ola, ${name}!</h2><p style="color:#5C6B7A;margin-bottom:24px;">Use o codigo abaixo para confirmar seu e-mail. Expira em <strong>15 minutos</strong>.</p><div style="background:#fff;border-radius:12px;padding:24px;text-align:center;border:2px solid #FF6B00;margin-bottom:24px;"><span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#FF6B00;">${code}</span></div><p style="color:#A8B5C0;font-size:13px;">Se voce nao criou uma conta no Ja!, ignore este e-mail.</p></div>`,
  });
};

const sendApprovalEmail = async (email, name) => {
  await sendMail({
    to: email,
    subject: 'Sua conta foi aprovada - Já!',
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f6fa;padding:32px;border-radius:16px;">${logoHtml}<div style="background:#fff;border-radius:12px;padding:28px;text-align:center;margin-bottom:20px;border-top:4px solid #00C853;"><div style="font-size:48px;margin-bottom:12px;">&#127881;</div><h2 style="color:#1A1A2E;margin-bottom:8px;">Conta Aprovada!</h2><p style="color:#5C6B7A;">Parabens, <strong>${name}</strong>! Sua identidade foi verificada com sucesso.</p></div><p style="color:#5C6B7A;line-height:1.6;">Voce ja pode acessar o app e aproveitar todos os recursos da plataforma <strong>Já!</strong>. Bem-vindo(a) a nossa comunidade!</p></div>`,
  });
};

const sendRejectionEmail = async (email, name, reason) => {
  await sendMail({
    to: email,
    subject: 'Atualizacao sobre seu cadastro - Já!',
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f6fa;padding:32px;border-radius:16px;">${logoHtml}<div style="background:#fff;border-radius:12px;padding:28px;margin-bottom:20px;border-top:4px solid #FF6B00;"><h2 style="color:#1A1A2E;margin-bottom:8px;">Ola, ${name}</h2><p style="color:#5C6B7A;line-height:1.6;">Apos analise, nao conseguimos aprovar seu cadastro neste momento.</p><div style="background:#fff8f5;border-radius:8px;padding:16px;border-left:4px solid #FF6B00;margin:16px 0;"><p style="color:#1A1A2E;margin:0;font-size:14px;"><strong>Motivo:</strong> ${reason}</p></div><p style="color:#5C6B7A;font-size:14px;">Voce pode tentar novamente apos corrigir o problema. Abra o app e envie novos documentos.</p></div></div>`,
  });
};

module.exports = { sendVerificationEmail, sendApprovalEmail, sendRejectionEmail };
