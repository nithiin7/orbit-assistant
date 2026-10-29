import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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

  const { title, description, icon } = item;

  return (
    <div className="space-y-8">
      <PageHeader
        title={title}
        description={description}
        actions={<Badge variant="outline">Planned</Badge>}
      />
      <EmptyState
        icon={icon}
        title={`${title} isn’t available yet`}
        description="This section is a placeholder. It doesn’t store or sync any data yet."
      >
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to dashboard
        </Link>
      </EmptyState>
    </div>
  );
}
