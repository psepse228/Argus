"""Supabase Storage for generated Справка files — replaces the server-local
tempfile.mkdtemp() dirs, which don't survive a backend restart. The bucket is
private (files contain real client name/phone); files are only ever served
through spravka.py's download endpoint after its tenant-ownership check,
never via a public URL.
"""
from functools import lru_cache

from app.db import get_service_client

SPRAVKA_BUCKET = "spravka-files"

_XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@lru_cache(maxsize=1)
def _ensure_bucket() -> None:
    client = get_service_client()
    existing = {b.id for b in client.storage.list_buckets()}
    if SPRAVKA_BUCKET not in existing:
        client.storage.create_bucket(SPRAVKA_BUCKET, options={"public": False})


def upload_spravka(tenant_id: str, request_id: str, local_path: str) -> str:
    """Uploads the locally-generated file and returns its storage path."""
    _ensure_bucket()
    storage_path = f"{tenant_id}/{request_id}.xlsx"
    with open(local_path, "rb") as f:
        get_service_client().storage.from_(SPRAVKA_BUCKET).upload(
            storage_path, f.read(),
            file_options={"content-type": _XLSX_CONTENT_TYPE, "upsert": "true"},
        )
    return storage_path


def download_spravka(storage_path: str) -> bytes:
    return get_service_client().storage.from_(SPRAVKA_BUCKET).download(storage_path)
