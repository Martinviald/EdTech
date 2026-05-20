'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

type MockUser = {
  email: string;
  name: string;
  role: string;
  orgName: string;
};

export function MockLoginForm({ users }: { users: MockUser[] }) {
  const [email, setEmail] = useState(users[0]?.email ?? '');
  const [loading, setLoading] = useState(false);
  const selected = users.find((u) => u.email === email);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    await signIn('mock', { email, callbackUrl: '/dashboard' });
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Usuario de prueba</span>
        <select
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {users.map((u) => (
            <option key={u.email} value={u.email}>
              {u.name} — {u.email}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground/70">
          <div>
            <span className="font-medium">Rol:</span> {selected.role}
          </div>
          <div>
            <span className="font-medium">Organización:</span> {selected.orgName}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !email}
        className="w-full rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? 'Iniciando…' : 'Login con usuario de prueba'}
      </button>
    </form>
  );
}
