import { Resend } from "resend"

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character])
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  })
}

const RESEND_TEST_SENDER = "onboarding@resend.dev"
const RESEND_TEST_ACCOUNT_EMAIL = "expedicao@formulaplus.com.br"

export function resolveTrackingRecipient(customer = {}, sender = process.env.RESEND_FROM_EMAIL || "") {
  if (String(sender).trim().toLowerCase() === RESEND_TEST_SENDER) {
    return RESEND_TEST_ACCOUNT_EMAIL
  }
  return String(process.env.RESEND_TO_EMAIL || customer.email || "").trim()
}

export async function sendOrderNotification(order) {
  const customer = order.customer || {}
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: "not_configured" }

  const sender = String(process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev").trim()
  const recipient = sender.toLowerCase() === RESEND_TEST_SENDER
    ? RESEND_TEST_ACCOUNT_EMAIL
    : process.env.RESEND_TO_EMAIL || "expedicao@formaplusrj.com.br"
  const shipping = order.shipping || {}
  const address = shipping.to || {}
  const total = Number(order.amount || 0) + Number(order.shippingAmount || 0)
  const orderId = order.orderId || "Pedido sem identificador"
  const productName = order.productName || "Produto não informado"
  const quantity = Number(order.quantity || 1)
  const addressLines = [
    [address.address, address.number].filter(Boolean).join(", "),
    [address.complement, address.district].filter(Boolean).join(" - "),
    [address.city, address.state_abbr].filter(Boolean).join(" / "),
    address.postal_code
  ].filter(Boolean)

  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from: sender,
    to: recipient,
    subject: `Novo pedido ${orderId} - ${customer.name || "Cliente"}`,
    text: [
      "Novo pedido recebido",
      `Pedido: ${orderId}`,
      `Cliente: ${customer.name || "Não informado"}`,
      `Email: ${customer.email || "Não informado"}`,
      `Produto: ${productName} (${quantity} un.)`,
      `Frete: ${shipping.service || "Não informado"}`,
      `Endereço: ${addressLines.join(", ") || "Não informado"}`,
      `Total do produto e frete: ${formatCurrency(total)}`,
      `Pagamento: ${order.paymentMethod || "Não informado"} - ${order.status || "Aguardando confirmação"}`
    ].join("\n"),
    html: `
      <main style="font-family:Arial,sans-serif;color:#202923;line-height:1.5;max-width:640px;margin:0 auto">
        <h1 style="font-size:22px">Novo pedido recebido</h1>
        <p><strong>Pedido:</strong> ${escapeHtml(orderId)}</p>
        <p><strong>Status do pagamento:</strong> ${escapeHtml(order.status || "Aguardando confirmação")}</p>
        <hr style="border:0;border-top:1px solid #dce4df;margin:20px 0">
        <h2 style="font-size:17px">Cliente</h2>
        <p>${escapeHtml(customer.name || "Não informado")}<br>${escapeHtml(customer.email || "Email não informado")}</p>
        <h2 style="font-size:17px">Produto e envio</h2>
        <p>${escapeHtml(productName)} · ${escapeHtml(quantity)} unidade(s)<br>Frete: ${escapeHtml(shipping.service || "Não informado")}</p>
        <p>${addressLines.map(escapeHtml).join("<br>") || "Endereço não informado"}</p>
        <p><strong>Total do produto e frete: ${escapeHtml(formatCurrency(total))}</strong></p>
        <p>Pagamento: ${escapeHtml(order.paymentMethod || "Não informado")}</p>
      </main>
    `
  })

  if (error) throw new Error(error.message || "O Resend não conseguiu enviar o email.")
  return { sent: Boolean(data?.id), id: data?.id || null }
}

export function buildTrackingEmail({ orderId, customer = {}, shipping = {}, trackingCode }) {
  const customerName = customer.name || "Cliente"
  const customerEmail = customer.email || "Não informado"
  const carrier = shipping.serviceName || "transportadora"
  return {
    subject: `Rastreio do pedido ${orderId} - RLV Fórmulas`,
    text: [
      "O pedido foi marcado como enviado.",
      `Pedido: ${orderId}`,
      `Cliente: ${customerName}`,
      `Email do cliente: ${customerEmail}`,
      `Transportadora: ${carrier}`,
      `Código de rastreio: ${trackingCode}`
    ].join("\n"),
    html: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;background:#f1f6f3;font-family:Arial,sans-serif;color:#202923">
        <tr><td align="center" style="padding:32px 14px">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce8e1;border-radius:8px;overflow:hidden">
            <tr><td style="padding:22px 28px;background:#006c47;color:#ffffff">
              <div style="font-size:12px;font-weight:bold;letter-spacing:2px">RLV FÓRMULAS</div>
              <div style="margin-top:5px;font-size:20px;font-weight:bold">Seu pedido foi enviado</div>
            </td></tr>
            <tr><td style="padding:26px 28px 30px;line-height:1.6">
              <p style="margin:0 0 18px">Um pedido foi marcado como enviado. Seguem os dados para acompanhamento.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#f2fbf6;border:1px solid #cce9d9;border-radius:6px">
                <tr><td style="padding:15px 17px">
                  <div style="color:#426253;font-size:12px">CÓDIGO DE RASTREIO</div>
                  <div style="margin-top:5px;color:#006c47;font-size:21px;font-weight:bold;letter-spacing:1px">${escapeHtml(trackingCode)}</div>
                </td></tr>
              </table>
              <p style="margin:0;color:#53665b;font-size:14px"><strong style="color:#263b30">Pedido:</strong> ${escapeHtml(orderId)}<br>
              <strong style="color:#263b30">Cliente:</strong> ${escapeHtml(customerName)} (${escapeHtml(customerEmail)})<br>
              <strong style="color:#263b30">Transportadora:</strong> ${escapeHtml(carrier)}</p>
            </td></tr>
            <tr><td style="padding:14px 28px;background:#e8f5ed;color:#426253;font-size:12px">RLV Fórmulas · Cuidado em cada etapa do seu pedido.</td></tr>
          </table>
        </td></tr>
      </table>
    `
  }
}

export async function sendTrackingNotification({ orderId, customer = {}, shipping = {}, trackingCode }) {
  const recipient = resolveTrackingRecipient(customer)
  if (!recipient) return { sent: false, reason: "missing_recipient" }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: "not_configured" }
  const sender = String(process.env.RESEND_FROM_EMAIL || "").trim()
  if (!sender) return { sent: false, reason: "sender_not_configured" }

  const email = buildTrackingEmail({ orderId, customer, shipping, trackingCode })
  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({ from: sender, to: recipient, ...email })

  if (error) throw new Error(error.message || "O Resend não conseguiu enviar o email de rastreio.")
  return { sent: Boolean(data?.id), id: data?.id || null }
}