import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { findSection, sectionItems } from "@/lib/navigation";

// Only the sections defined in navigation exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return sectionItems.map((item) => ({ section: item.href.slice(1) }));
}

export async function generateMetadata(props: PageProps<"/[section]">): Promise<Metadata> {
  const { section } = await props.params;
  return { title: findSection(section)?.title };
}

export default async function SectionPage(props: PageProps<"/[section]">) {
  const { section } = await props.params;
  const item = findSection(section);
  if (!item) notFound();

  const { title, description, icon: Icon } = item;

  return (
    <div className="space-y-8">
      <PageHeader title={title} description={description} />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold">{title} is coming soon</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This section is a placeholder and does not store any data yet.
        </p>
      </div>
    </div>
  );
}
