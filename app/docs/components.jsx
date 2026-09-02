// Shared building blocks for the /docs section. Every piece reuses the
// site's existing design tokens and motifs (mono eyebrow labels, the
// border-(--color-rule)/bg-(--color-card) card, the record-block look from
// the claim form and site profile page) rather than introducing a new
// visual system for docs.

export function Eyebrow({ children }) {
  return (
    <p className="font-(family-name:--font-mono) text-xs tracking-[0.14em] text-(--color-muted) uppercase">
      {children}
    </p>
  );
}

export function DocTitle({ children }) {
  return (
    <h1 className="font-(family-name:--font-display) text-3xl font-medium tracking-tight text-(--color-ink) sm:text-4xl">
      {children}
    </h1>
  );
}

export function Lede({ children }) {
  return <p className="mt-4 text-sm leading-relaxed text-(--color-muted) sm:text-base">{children}</p>;
}

// Inline code, e.g. a field name or filename mentioned in prose.
export function C({ children }) {
  return (
    <code className="border border-(--color-rule) bg-(--color-card) px-1 py-0.5 font-(family-name:--font-mono) text-(--color-ink)">
      {children}
    </code>
  );
}

export function Code({ children }) {
  return (
    <pre className="overflow-x-auto border border-(--color-rule) bg-(--color-card) p-4 font-(family-name:--font-mono) text-xs leading-relaxed text-(--color-ink)">
      <code>{children}</code>
    </pre>
  );
}

// A JSON record example with the path label above it, the same pairing
// used by the claim form (domains/<name>.json) and the site profile page.
export function Record({ path, children }) {
  return (
    <div className="border-l-2 border-(--color-signal) py-1 pl-4">
      <p className="font-(family-name:--font-mono) text-[11px] text-(--color-muted) sm:text-xs">{path}</p>
      <div className="mt-2">
        <Code>{children}</Code>
      </div>
    </div>
  );
}

// A flagged constraint the schema cannot express, styled with the flag
// token rather than the signal one, so it reads as distinct from a normal
// Quote callout.
export function Warning({ children }) {
  return (
    <p className="border-l-2 border-(--color-flag) bg-(--color-card) p-4 text-sm leading-relaxed">
      {children}
    </p>
  );
}

export function DocList({ items }) {
  return (
    <ul className="space-y-1.5 text-sm sm:text-base">
      {items.map((item) => (
        <li key={item.href}>
          <a className="text-(--color-signal) underline" href={item.href}>
            {item.label}
          </a>
          {item.note && <span className="text-(--color-muted)"> — {item.note}</span>}
        </li>
      ))}
    </ul>
  );
}

// Every provider guide ends in the same place: a record that has to reach
// domains/<name>.json. There are two ways to get it there and the guides
// walk through the pull request one, so this names the shorter path once,
// in one component, rather than in thirteen hand-written step lists.
export function ApplyNote() {
  return (
    <p className="border-l-2 border-(--color-signal) bg-(--color-card) p-4 text-sm leading-relaxed">
      Two ways to apply this. The quickest is{' '}
      <a className="text-(--color-signal) underline" href="/manage">
        runs-on.dev/manage
      </a>
      : sign in, pick the record type, paste the value, save. It writes the same
      commit to the registry and DNS follows within seconds. The steps below do
      it by pull request instead, which is what you want if you would rather
      review the change first. Either way handles <C>subdomains</C> entries.
    </p>
  );
}
