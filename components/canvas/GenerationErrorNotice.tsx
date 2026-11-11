import { Alert } from "@/components/ui";
import { describeGenerationError } from "@/lib/generation/errors";

export function GenerationErrorNotice({ message }: { message: string }) {
  const error = describeGenerationError(message);
  return (
    <Alert tone="error" className="text-xs">
      <p>{error.message}</p>
      {error.advice && <p className="mt-1">{error.advice}</p>}
      {error.code && (
        <details className="mt-2 break-words text-white/50">
          <summary className="cursor-pointer">上游错误详情</summary>
          <p>{message}</p>
        </details>
      )}
    </Alert>
  );
}
