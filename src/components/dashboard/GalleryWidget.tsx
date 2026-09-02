import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Image, ChevronRight, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Media } from "@/types/entities";
import { MediaImage } from "@/components/MediaImage";

interface Props {
  media: Media[];
  projectId: string;
  className?: string;
}

export function GalleryWidget({ media, projectId, className }: Props) {
  const { t } = useTranslation();
  return (
    <div className={cn("glass rounded-card p-sp-2 h-full flex flex-col", className)}>
      <div className="flex items-center justify-between mb-sp-2">
        <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
          <Image className="h-4 w-4 text-accent" /> {t("galleryWidget.title")}
        </h3>
        <Link
          to={`/project/${projectId}/gallery`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-accent hover:bg-accent/10 transition-colors"
          aria-label={t("galleryWidget.viewAllAria")}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="flex-1">
        {media.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {media.slice(0, 4).map((m) => (
              <div key={m.id} className="space-y-1">
                <div className="rounded-panel bg-muted/40 aspect-square flex items-center justify-center p-1 overflow-hidden relative">
                  <MediaImage
                    storage={m.storage}
                    alt={m.caption}
                    imgClassName="absolute inset-0 h-full w-full object-cover"
                    fallback={<Camera className="h-5 w-5 text-muted-foreground" />}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-2">
                  {m.description || m.caption}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-caption text-muted-foreground text-center py-sp-2">{t("galleryWidget.empty")}</p>
        )}
      </div>
    </div>
  );
}
