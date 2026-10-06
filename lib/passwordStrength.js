export const MIN_PASSWORD_LENGTH = 8;

export function getPasswordStrength(pass) {
  if (!pass) return { label: "", score: 0, color: "", barColor: "" };
  if (pass.length < MIN_PASSWORD_LENGTH) {
    return { label: `Too short (min ${MIN_PASSWORD_LENGTH} chars)`, score: 1, color: "text-rose-400", barColor: "bg-rose-500" };
  }

  let score = 0;
  if (pass.length >= 10) score++;
  if (pass.length >= 14) score++;
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;

  if (score <= 2) return { label: "Weak", score: 1, color: "text-amber-400", barColor: "bg-amber-500" };
  if (score <= 3) return { label: "Medium", score: 2, color: "text-emerald-400", barColor: "bg-emerald-400" };
  return { label: "Strong", score: 3, color: "text-emerald-300", barColor: "bg-emerald-300" };
}

export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
