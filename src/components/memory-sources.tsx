import type { MemorySource } from "../domain/memory-source";
export function MemorySources({ sources }: { sources?: MemorySource[] }) {
  return (
    <details className="small">
      <summary>Source evidence</summary>
      {!sources?.length ? (
        <p>
          Source was not captured in this older response. Inspect Memory review
          for available provenance.
        </p>
      ) : (
        sources.map((source) => (
          <div key={source.id}>
            <p>
              <strong>{source.kind.replaceAll("_", " ")}</strong> ·{" "}
              {source.operation}
            </p>
            <p>{source.reference}</p>
            {source.quote ? (
              <blockquote>{source.quote}</blockquote>
            ) : (
              <p>
                Original evidence unavailable; this historical snapshot is not
                proof of the claim.
              </p>
            )}
            <p>
              Captured {new Date(source.created_at).toLocaleString()}.
              Provenance identifies the input; it does not independently verify
              the fact.
            </p>
          </div>
        ))
      )}
    </details>
  );
}
