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

export function resolveTrackingRecipient(customer = {}) {
  return String(process.env.EMAILJS_TRACKING_TO_EMAIL || customer.email || "").trim()
}

function emailJsConfiguration(templateId) {
  return {
    serviceId: process.env.EMAILJS_SERVICE_ID,
    templateId,
    publicKey: process.env.EMAILJS_PUBLIC_KEY,
    privateKey: process.env.EMAILJS_PRIVATE_KEY
  }
}

async function sendEmailJs(templateId, recipient, email, templateParams = {}) {
  const config = emailJsConfiguration(templateId)
  if (Object.values(config).some((value) => !String(value || "").trim())) {
    return { sent: false, reason: "not_configured" }
  }

  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: config.serviceId,
      template_id: config.templateId,
      user_id: config.publicKey,
      accessToken: config.privateKey,
      template_params: {
        to_email: recipient,
        subject: email.subject,
        message: email.text,
        message_html: email.html,
        ...templateParams
      }
    })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || "O EmailJS não conseguiu enviar o e-mail.")
  }
  return { sent: true, id: null }
}

export async function sendOrderNotification(order) {
  const customer = order.customer || {}
  const recipient = String(process.env.EMAILJS_TO_EMAIL || "expedicao@formaplusrj.com.br").trim()
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
  const text = [
    "Novo pedido recebido",
    `Pedido: ${orderId}`,
    `Cliente: ${customer.name || "Não informado"}`,
    `Email: ${customer.email || "Não informado"}`,
    `Produto: ${productName} (${quantity} un.)`,
    `Frete: ${shipping.service || "Não informado"}`,
    `Endereço: ${addressLines.join(", ") || "Não informado"}`,
    `Total do produto e frete: ${formatCurrency(total)}`,
    `Pagamento: ${order.paymentMethod || "Não informado"} - ${order.status || "Aguardando confirmação"}`
  ].join("\n")
  const html = `
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
  return sendEmailJs(process.env.EMAILJS_ORDER_TEMPLATE_ID, recipient, {
    subject: `Novo pedido ${orderId} - ${customer.name || "Cliente"}`,
    text,
    html
  })
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
  return sendEmailJs(
    process.env.EMAILJS_TRACKING_TEMPLATE_ID,
    recipient,
    buildTrackingEmail({ orderId, customer, shipping, trackingCode }),
    { name: customer.name || "Cliente", tracking_code: trackingCode }
  )
}