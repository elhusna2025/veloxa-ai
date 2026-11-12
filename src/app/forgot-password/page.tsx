"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, Loader2, Mail, MailCheck } from "lucide-react";
import VeloxaDedicatedPageShell from "@/components/VeloxaDedicatedPageShell";
import { type VeloxaLocale } from "@/lib/veloxa-i18n";
import { sendVeloxaPasswordReset } from "@/lib/veloxa-auth";
import authStyles from "@/components/VeloxaAuthScreen.module.css";
import styles from "@/components/VeloxaDedicatedPageShell.module.css";

export default function VeloxaForgotPasswordPage() {
  const [locale, setLocale] = useState<VeloxaLocale>("id");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const notice = useRef<HTMLDivElement>(null);
  const isId = locale === "id";

  useEffect(() => {
    if (error || sentTo) notice.current?.focus();
  }, [error, sentTo]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();

    setBusy(true);
    setError(false);
    try {
      await sendVeloxaPasswordReset(address);
      setSentTo(address);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <VeloxaDedicatedPageShell
      activePage="forgot-password"
      locale={locale}
      onLocaleChange={setLocale}
      pageTitle={isId ? "Lupa kata sandi?" : "Forgot your password?"}
      pageSubtitle={sentTo ? undefined : isId
        ? "Masukkan email akun Anda untuk menerima tautan pengaturan ulang kata sandi."
        : "Enter your account email to receive a password reset link."}
    >
      {sentTo ? (
        <div ref={notice} role="status" tabIndex={-1} className={styles.recoverySuccess}>
          <MailCheck size={24} aria-hidden="true" />
          <h2>{isId ? "Periksa kotak masuk" : "Check your inbox"}</h2>
          <p>{isId
            ? <>Jika akun terdaftar, instruksi reset akan dikirim ke <bdi>{sentTo}</bdi>.</>
            : <>If an account exists, reset instructions will be sent to <bdi>{sentTo}</bdi>.</>}</p>
          <p>{isId ? "Periksa folder Spam jika email belum terlihat." : "Check your spam folder if you don’t see the email."}</p>
          <button type="button" className={authStyles.secondary} onClick={() => setSentTo(null)}>
            {isId ? "Gunakan email lain" : "Use another email"}
          </button>
        </div>
      ) : (
        <form method="post" action="/forgot-password/" onSubmit={handleSubmit} className={authStyles.form}>
          <div className={authStyles.field}>
            <label htmlFor="forgot-email">{isId ? "Alamat email" : "Email address"}</label>
            <div className={authStyles.control}>
              <Mail size={18} aria-hidden="true" />
              <input id="forgot-email" name="email" type="email" inputMode="email" autoComplete="username"
                autoCapitalize="none" spellCheck={false} enterKeyHint="done" required value={email}
                onChange={event => setEmail(event.target.value)} />
            </div>
          </div>
          {error && (
            <div ref={notice} role="alert" tabIndex={-1} className={authStyles.error}>
              <CircleAlert size={18} aria-hidden="true" />
              {isId ? "Tautan belum bisa dikirim. Coba lagi." : "Could not send a reset link. Please try again."}
            </div>
          )}
          <button type="submit" disabled={busy} className={authStyles.primary}>
            {busy && <Loader2 className={authStyles.spinner} size={18} aria-hidden="true" />}
            {busy ? (isId ? "Mengirim tautan…" : "Sending link…") : (isId ? "Kirim tautan reset" : "Send reset link")}
          </button>
          <span role="status" className="sr-only">{busy && (isId ? "Mengirim tautan…" : "Sending link…")}</span>
        </form>
      )}
      <Link href="/login/" className={styles.back}><ArrowLeft size={18} aria-hidden="true" />
        {isId ? "Kembali ke Masuk" : "Back to sign in"}
      </Link>
    </VeloxaDedicatedPageShell>
  );
}
