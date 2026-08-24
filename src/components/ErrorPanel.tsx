/**
 * Something went wrong, and what to do about it.
 *
 * The hint used to be a hardcoded line about Google Sheets credentials, printed
 * under every error this component has ever shown. That was true when the only
 * store was a spreadsheet and became actively misleading once there were three:
 * a Supabase migration that has not been run is not fixed by re-sharing a
 * sheet, and telling somebody to go and check one is telling them to spend
 * twenty minutes in the wrong place.
 *
 * So it is a prop now, defaulting to the old text so every existing caller says
 * exactly what it said before. Pass an empty string where the message already
 * carries its own instruction.
 */
export function ErrorPanel({
  title,
  message,
  hint = 'Check GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY (or your service-account.json), and confirm the sheet is shared with the service account as an Editor.',
}: {
  title: string;
  message: string;
  hint?: string;
}) {
  return (
    <div className="panel mx-auto max-w-[900px] border-alarm bg-alarm-wash p-5 sm:p-6" role="alert">
      <h2 className="label-cap text-alarm">{title}</h2>
      <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed">{message}</p>
      {hint ? <p className="plain mt-3">{hint}</p> : null}
    </div>
  );
}
