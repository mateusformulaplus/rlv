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

export async function sendOrderNotification(order) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: "not_configured" }

  const customer = order.customer || {}
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
    from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
    to: process.env.RESEND_TO_EMAIL || "expedicao@formaplusrj.com.br",
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