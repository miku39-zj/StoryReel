import type { ConditionNodeData, StoryEdgeData, VariableOperation, Predicate } from "./types";
export function testPredicate(rule: Predicate, variables: Record<string, unknown>): boolean {
  if (!rule.variable || !Object.hasOwn(variables, rule.variable))
    throw new Error(`条件变量「${rule.variable}」未设置初始值`);
  const left = variables[rule.variable],
    right = rule.value;
  if (typeof left !== typeof right) throw new Error(`变量「${rule.variable}」的比较值类型不一致`);
  switch (rule.operator) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
    case "<":
    case ">=":
    case "<=":
      if (
        typeof left !== "number" ||
        typeof right !== "number" ||
        !Number.isFinite(left) ||
        !Number.isFinite(right)
      )
        throw new Error("大小比较需要有限数字");
      return rule.operator === ">"
        ? left > right
        : rule.operator === "<"
          ? left < right
          : rule.operator === ">="
            ? left >= right
            : left <= right;
    default:
      throw new Error("无效比较操作符");
  }
}
export function evaluateCondition(data: ConditionNodeData, variables: Record<string, unknown>) {
  const rules = data.conditions?.length
    ? data.conditions
    : [{ variable: data.variable ?? "", operator: data.operator!, value: data.value! }];
  const results = rules.map((rule) => ({
    rule,
    actual: variables[rule.variable],
    matched: testPredicate(rule, variables),
  }));
  return {
    matched:
      data.conditionMode === "any"
        ? results.some((r) => r.matched)
        : results.every((r) => r.matched),
    results,
  };
}
export function applyVariables(
  current: Record<string, unknown>,
  data?: StoryEdgeData,
): Record<string, unknown> {
  const next = { ...current };
  const ops: VariableOperation[] = [
    ...Object.entries(data?.setVariables ?? {}).map(([variable, value]) => ({
      variable,
      operation: "set" as const,
      value,
    })),
    ...(data?.variableOperations ?? []),
  ];
  for (const op of ops) {
    if (!Object.hasOwn(next, op.variable)) throw new Error(`未声明的变量「${op.variable}」`);
    const before = next[op.variable];
    if (op.operation === "set") {
      if (typeof before !== typeof op.value)
        throw new Error(`变量「${op.variable}」赋值类型不一致`);
      next[op.variable] = op.value;
    } else if (op.operation === "toggle") {
      if (typeof before !== "boolean") throw new Error("取反只支持布尔变量");
      next[op.variable] = !before;
    } else if (op.operation === "add" || op.operation === "subtract") {
      if (typeof before !== "number" || typeof op.value !== "number")
        throw new Error("加减只支持数字变量");
      const value = before + (op.operation === "add" ? op.value : -op.value);
      if (!Number.isFinite(value)) throw new Error("变量运算超出数字范围");
      next[op.variable] = value;
    } else throw new Error("无效变量操作");
  }
  return next;
}
