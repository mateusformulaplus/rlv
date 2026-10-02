export async function sendTrackingNotification({ orderId, customer = {}, trackingCode }) {
  const config = {
    serviceId: process.env.EMAILJS_SERVICE_ID,
    templateId: process.env.EMAILJS_TRACKING_TEMPLATE_ID,
    publicKey: process.env.EMAILJS_PUBLIC_KEY,
    privateKey: process.env.EMAILJS_PRIVATE_KEY
  }

  if (Object.values(config).some((value) => !String(value || "").trim())) {
    return { sent: false, reason: "not_configured" }
  }

  const recipient = String(process.env.EMAILJS_TRACKING_TO_EMAIL || customer.email || "").trim()
  if (!recipient) return { sent: false, reason: "missing_recipient" }

  const subject = `Rastreio do pedido ${orderId} - RLV Fórmulas`
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
        subject,
        name: customer.name || "Cliente",
        tracking_code: trackingCode
      }
    })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || "O EmailJS não conseguiu enviar o código de rastreio.")
  }
  return { sent: true }
}