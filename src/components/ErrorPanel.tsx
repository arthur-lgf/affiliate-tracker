export function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <div
      className="mx-auto max-w-[900px] rounded-[20px] border-2 border-alarm bg-alarm-wash p-6 sm:p-8"
      role="alert"
    >
      <h2 className="label-cap text-alarm">{title}</h2>
      <p className="mt-3 max-w-2xl text-[21px] leading-relaxed">{message}</p>
      <p className="plain mt-4">
        Check GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY (or your
        service-account.json), and confirm the sheet is shared with the service account as an
        Editor.
      </p>
    </div>
  );
}
