"use client";
import NextImage from "next/image";
import { AssetLibrary } from "@/components/AssetLibrary";
import { Button, Textarea } from "@/components/ui";
import type { CreationBrief } from "@/lib/story/creation-brief";

type References = CreationBrief["references"];
type Props = { value: References; onChange: (value: References) => void };
export function CreationReferenceList({ value, onChange }: Props) {
  if (!value.length) return null;
  return (
    <div className="my-4 space-y-3 px-4">
      <p className="text-xs text-white/50">
        文本创作使用参考说明；图片保留到项目画布，供后续生成手动引用。
      </p>
      {value.map((ref) => (
        <div key={ref.id} className="flex items-start gap-3">
          <NextImage
            loading="eager"
            unoptimized
            width={96}
            height={64}
            src={ref.url}
            alt={ref.name}
            className="h-16 w-24 shrink-0 rounded-lg object-contain"
          />
          <Textarea
            aria-label={`${ref.name} 参考说明`}
            placeholder="描述要参考的外貌或风格"
            value={ref.description}
            maxLength={2000}
            onChange={(e) =>
              onChange(
                value.map((item) =>
                  item.id === ref.id ? { ...item, description: e.target.value } : item,
                ),
              )
            }
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(value.filter((item) => item.id !== ref.id))}
          >
            移除
          </Button>
        </div>
      ))}
    </div>
  );
}
export function CreationReferencePicker({
  open,
  onClose,
  value,
  onChange,
}: Props & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="选择创作参考"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/95 p-6"
    >
      <div className="mx-auto max-w-4xl">
        <Button onClick={onClose}>返回创作</Button>
        <p className="my-3">最多添加 4 张参考图片，不会创建其他项目。已选 {value.length}/4。</p>
        {value.length >= 4 ? (
          <p role="status">已达上限，请返回创作移除参考后再添加。</p>
        ) : (
          <AssetLibrary
            types={["image"]}
            onSelect={(asset) => {
              if (!value.some((item) => item.id === asset.id))
                onChange([
                  ...value,
                  { id: asset.id, name: asset.name, url: asset.url, description: "" },
                ]);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
