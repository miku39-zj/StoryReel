"use client";
import { useEffect, useId, useState } from "react";
import { Button, Textarea, Label, Alert } from "@/components/ui";
import { variablesSchema } from "@/lib/story/creation-schema";
import type { StoryVariables } from "@/lib/story/types";

export function VariableEditor({
  label,
  value,
  onSave,
}: {
  label: string;
  value: StoryVariables;
  onSave: (value: StoryVariables) => void;
}) {
  const id = useId();
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(serialized);
    setError(null);
  }, [serialized]);
  const save = () => {
    try {
      onSave(variablesSchema.parse(JSON.parse(text)));
      setError(null);
    } catch {
      setError(
        '请输入变量对象，例如 {"trust": 0, "hasKey": false}，变量名使用字母、数字和下划线。',
      );
    }
  };
  return (
    <div className="space-y-3">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        spellCheck={false}
      />
      <p className="text-xs leading-relaxed text-white/50">
        支持数字、文本和布尔值。例如：{`{"trust": 0, "hasKey": false}`}
        。路线赋值使用已声明的变量名。
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <Button variant="secondary" disabled={text === serialized} onClick={save}>
        保存变量
      </Button>
    </div>
  );
}
