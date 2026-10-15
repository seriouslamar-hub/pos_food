import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Section = {
  title: string;
  description: string;
  phase: string;
  href?: string;
};

/** Landing page for a back-office role: what's available now and what's next. */
export function BackOfficeHome({
  heading,
  intro,
  sections,
}: {
  heading: string;
  intro: string;
  sections: Section[];
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground">{intro}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const card = (
            <Card
              className="h-full transition-colors data-[link=true]:hover:bg-muted/50"
              data-link={Boolean(section.href)}
            >
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {section.href ? "Open" : `Coming in ${section.phase}`}
              </CardContent>
            </Card>
          );
          return section.href ? (
            <Link key={section.title} href={section.href}>
              {card}
            </Link>
          ) : (
            <div key={section.title}>{card}</div>
          );
        })}
      </div>
    </main>
  );
}

export function BackOfficeSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </main>
  );
}
