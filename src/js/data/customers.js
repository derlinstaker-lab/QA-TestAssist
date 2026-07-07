export async function loadCustomers() {
  const resp = await fetch('/api/customers');
  if (!resp.ok) throw new Error(`Customer API error: ${resp.status}`);
  return resp.json();
}
