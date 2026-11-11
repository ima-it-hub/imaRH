import Image from "next/image";

type LogoProps = {
  variant?: "full" | "compact";
  className?: string;
};

export function Logo({ variant = "full", className = "" }: LogoProps) {
  if (variant === "compact") {
    return (
      <div className={`flex w-full items-center justify-center ${className}`}>
        <Image
          src="/logo.png"
          alt="IMA Plomberie"
          width={700}
          height={400}
          className="h-full max-h-11 w-full max-w-36 object-contain"
          style={{ height: "auto" }}
          priority
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <Image
        src="/logo.png"
        alt="IMA Plomberie"
        width={700}
        height={400}
        className="object-contain"
        style={{ width: 260, height: "auto" }}
        priority
      />
    </div>
  );
}
