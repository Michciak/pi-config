import { useMemo, useState } from "react";
import type { UserAnswer, UserQuestion } from "@pi-local/protocol";

export function QuestionCard(props: {
  question: UserQuestion;
  onAnswer: (answers: UserAnswer[]) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const { question } = props;
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => question.options.filter((option) => !option.isOther), [question.options]);
  const otherLabel = useMemo(() => question.options.find((option) => option.isOther)?.label ?? "Other", [question.options]);

  async function submit() {
    setBusy(true);
    try {
      if (question.mode === "text") {
        await props.onAnswer([{ type: "text", label: text.trim(), value: text.trim() }]);
        return;
      }
      const answers: UserAnswer[] = [];
      for (const id of selected) {
        if (id === "other") {
          answers.push({ type: "other", label: other.trim(), value: other.trim() });
          continue;
        }
        const option = options.find((item) => item.id === id);
        if (option?.index) answers.push({ type: "option", label: option.label, value: option.value, index: option.index });
      }
      await props.onAnswer(answers);
    } finally { setBusy(false); }
  }

  function choose(id: string) {
    setSelected((current) => question.mode === "single-select"
      ? [id]
      : current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const valid = question.mode === "text"
    || (selected.length > 0 && (!selected.includes("other") || other.trim().length > 0));

  return <article id={`interaction-${question.id}`} className="interaction question-card">
    <div className="interaction-tag">PYTANIE · {question.source.name ?? question.source.kind}</div>
    <h3>{question.question}</h3>
    {question.details && <p className="details">{question.details}</p>}
    {question.mode === "text" ? <textarea
      autoFocus value={text} onChange={(event) => setText(event.target.value)}
      placeholder="Wpisz odpowiedź…" rows={4}
    /> : <div className="option-list">
      {options.map((option) => <label className="option" key={option.id}>
        <input type={question.mode === "single-select" ? "radio" : "checkbox"}
          checked={selected.includes(option.id)} onChange={() => choose(option.id)} />
        <span><strong>{option.index}. {option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}
      {question.allowOther && <label className="option">
        <input type={question.mode === "single-select" ? "radio" : "checkbox"}
          checked={selected.includes("other")} onChange={() => choose("other")} />
        <span><strong>{otherLabel}</strong><input className="other-input" value={other}
          onFocus={() => !selected.includes("other") && choose("other")}
          onChange={(event) => setOther(event.target.value)} placeholder="Własna odpowiedź" /></span>
      </label>}
    </div>}
    <div className="interaction-actions">
      <button className="ghost" disabled={busy} onClick={() => props.onCancel()}>Anuluj</button>
      <button disabled={busy || !valid} onClick={submit}>Odpowiedz</button>
    </div>
  </article>;
}
