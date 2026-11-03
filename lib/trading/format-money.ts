const moneyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

type MoneyFormatOptions = {
  asset?: string
  prefix?: string
  signed?: boolean
  unavailable?: string
}

export function formatMoney(
  value: number | null | undefined,
  { asset, prefix = '', signed = false, unavailable = '—' }: MoneyFormatOptions = {},
) {
  if (value == null || !Number.isFinite(value)) return unavailable

  const formattedValue = moneyFormatter.format(Math.abs(value))
  const isRoundedToZero = formattedValue === '0.00'
  const sign = isRoundedToZero ? '' : value < 0 ? '-' : signed && value > 0 ? '+' : ''
  const suffix = asset ? ` ${asset}` : ''

  return `${sign}${prefix}${formattedValue}${suffix}`
}

export function formatQuantity(value: number | null | undefined, maximumFractionDigits = 8) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { maximumFractionDigits })
}

export function formatMoneyText(value: string | null | undefined) {
  if (!value?.trim()) return '—'
  const numericValue = Number(value.replaceAll(',', '').trim())
  return Number.isFinite(numericValue) ? formatMoney(numericValue) : value
}
