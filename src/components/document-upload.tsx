"use client";

import { useState } from "react";
import { registerDocument } from "@/app/app/actions";
import { createClient } from "@/lib/supabase/client";

const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

export function DocumentUpload({ businessId }: { businessId: string }) {
  const [message, setMessage] = useState("");
  return <form className="upload-form" onSubmit={async (event) => {
    event.preventDefault(); setMessage(""); const data = new FormData(event.currentTarget); const file = data.get("file");
    if (!(file instanceof File) || !file.size || file.size > 10_485_760 || !allowed.has(file.type)) { setMessage("Choose a PDF, PNG, JPG, CSV or XLSX file up to 10 MB."); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-"); const storagePath = `${businessId}/${crypto.randomUUID()}-${safeName}`; const supabase = createClient();
    const { error } = await supabase.storage.from("business-documents").upload(storagePath, file, { contentType: file.type, upsert: false });
    if (error) { setMessage("Upload failed. Please try again."); return; }
    const metadata = new FormData(); metadata.set("businessId", businessId); metadata.set("storagePath", storagePath); metadata.set("filename", file.name); metadata.set("mimeType", file.type); metadata.set("sizeBytes", String(file.size));
    await registerDocument(metadata);
  }}><label>Upload document<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,application/pdf,image/png,image/jpeg,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label><button className="button" type="submit">Upload securely</button>{message && <p role="alert" className="alert">{message}</p>}</form>;
}
