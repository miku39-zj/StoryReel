"use client";
import { Button, Input, Select, Label } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvas-store";
import type { ConditionNodeData, Predicate, VariableOperation } from "@/lib/story/types";
function ValueInput({
  type,
  value,
  onChange,
}: {
  type: string;
  value: unknown;
  onChange: (v: string | number | boolean) => void;
}) {
  return type === "boolean" ? (
    <Select
      ariaLabel="布尔值"
      size="sm"
      value={String(value ?? false)}
      options={["true", "false"]}
      onChange={(v) => onChange(v === "true")}
    />
  ) : (
    <Input
      aria-label="变量值"
      type={type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(e) => {
        if (type === "number") {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        } else onChange(e.target.value);
      }}
    />
  );
}
export function ConditionRules({
  data,
  onChange,
}: {
  data: ConditionNodeData;
  onChange: (p: Partial<ConditionNodeData>) => void;
}) {
  const variables = useCanvasStore((s) => s.initialVariables),
    keys = Object.keys(variables);
  const rules = data.conditions?.length
    ? data.conditions
    : [{ variable: data.variable ?? "", operator: data.operator ?? "==", value: data.value ?? "" }];
  const write = (next: Predicate[]) =>
    onChange({
      conditions: next,
      variable: next[0]?.variable,
      operator: next[0]?.operator,
      value: next[0]?.value,
    });
  return (
    <section className="space-y-3">
      <Label>分支条件</Label>
      <Select
        ariaLabel="条件组合"
        size="sm"
        value={data.conditionMode ?? "all"}
        options={[
          { value: "all", label: "全部满足（AND）" },
          { value: "any", label: "任一满足（OR）" },
        ]}
        onChange={(v) => onChange({ conditionMode: v as "all" | "any" })}
      />
      {!keys.length && <p className="text-xs text-amber-300/80">先在“剧情变量”中声明变量。</p>}
      {rules.map((r, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-white/10 p-3">
          <Select
            ariaLabel={`条件 ${i + 1} 变量`}
            size="sm"
            value={r.variable}
            options={[
              { value: "", label: "选择变量" },
              ...keys.map((k) => ({ value: k, label: k })),
            ]}
            onChange={(variable) =>
              write(
                rules.map((old, j) =>
                  j === i ? { variable, operator: "==", value: variables[variable] } : old,
                ),
              )
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              ariaLabel={`条件 ${i + 1} 比较`}
              size="sm"
              value={r.operator}
              options={
                typeof variables[r.variable] === "number"
                  ? ["==", "!=", ">", "<", ">=", "<="]
                  : ["==", "!="]
              }
              onChange={(v) =>
                write(
                  rules.map((old, j) =>
                    j === i ? { ...old, operator: v as Predicate["operator"] } : old,
                  ),
                )
              }
            />
            <ValueInput
              type={typeof variables[r.variable]}
              value={r.value}
              onChange={(value) =>
                write(rules.map((old, j) => (j === i ? { ...old, value } : old)))
              }
            />
          </div>
          {rules.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => write(rules.filter((_, j) => i !== j))}
            >
              移除条件
            </Button>
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        disabled={!keys.length || rules.length >= 50}
        onClick={() =>
          write([...rules, { variable: keys[0], operator: "==", value: variables[keys[0]] }])
        }
      >
        添加条件
      </Button>
    </section>
  );
}
export function VariableOperations({
  value,
  onChange,
}: {
  value: VariableOperation[];
  onChange: (v: VariableOperation[]) => void;
}) {
  const variables = useCanvasStore((s) => s.initialVariables),
    keys = Object.keys(variables);
  const patch = (i: number, p: Partial<VariableOperation>) =>
    onChange(value.map((old, j) => (j === i ? { ...old, ...p } : old)));
  return (
    <section className="space-y-3">
      <Label>路线变量操作</Label>
      <p className="text-xs text-white/40">先执行上方赋值，再按顺序执行下面的操作。</p>
      {value.map((op, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-white/10 p-3">
          <Select
            ariaLabel={`操作 ${i + 1} 变量`}
            size="sm"
            value={op.variable}
            options={keys}
            onChange={(variable) =>
              patch(i, { variable, operation: "set", value: variables[variable] })
            }
          />
          <Select
            ariaLabel={`操作 ${i + 1} 类型`}
            size="sm"
            value={op.operation}
            options={[
              { value: "set", label: "赋值" },
              ...(typeof variables[op.variable] === "number"
                ? [
                    { value: "add", label: "增加" },
                    { value: "subtract", label: "减少" },
                  ]
                : typeof variables[op.variable] === "boolean"
                  ? [{ value: "toggle", label: "取反" }]
                  : []),
            ]}
            onChange={(v) => patch(i, { operation: v as VariableOperation["operation"] })}
          />
          {op.operation !== "toggle" && (
            <ValueInput
              type={typeof variables[op.variable]}
              value={op.value}
              onChange={(v) => patch(i, { value: v })}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            移除操作
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        disabled={!keys.length || value.length >= 100}
        onClick={() =>
          onChange([...value, { variable: keys[0], operation: "set", value: variables[keys[0]] }])
        }
      >
        添加变量操作
      </Button>
    </section>
  );
}
