"""Client identity -- before this, a "client" was just free-text (name,
phone) duplicated independently on leads and spravka_requests, with no
shared record. get_or_create_client is the single place that resolves a
phone number to a real client_id, called both by spravka creation (form and
chat-driven) and, going forward, wherever a lead gets a real intake path.
"""


def get_or_create_client(client, tenant_id: str, phone: str, name: str | None = None) -> str:
    existing = client.table("clients").select("id, name").eq("tenant_id", tenant_id).eq("phone", phone).execute().data
    if existing:
        row = existing[0]
        # backfill a name onto a client we'd only ever seen via a nameless lead
        if name and not row.get("name"):
            client.table("clients").update({"name": name}).eq("id", row["id"]).execute()
        return row["id"]
    inserted = client.table("clients").insert({"tenant_id": tenant_id, "phone": phone, "name": name}).execute().data[0]
    return inserted["id"]
