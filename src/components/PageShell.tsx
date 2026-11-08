type PageShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function PageShell({
  title,
  description,
  children,
  action,
  className = "max-w-6xl",
}: PageShellProps) {
  return (
    <div className={`mx-auto w-full ${className}`}>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-zinc-500 sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
