import Image from "next/image";

type LogoProps = {
  variant?: "full" | "compact";
  className?: string;
};

export function Logo({ variant = "full", className = "" }: LogoProps) {
  if (variant === "compact") {
    return (
      <div className={`flex items-center ${className}`}>
        <Image
          src="/ima-logo.jpg"
          alt="IMA Plomberie"
          width={160}
          height={72}
          className="h-11 w-auto rounded-md bg-white object-contain p-1"
          style={{ width: 160, height: "auto" }}
          priority
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <Image
        src="/ima-logo.jpg"
        alt="IMA Plomberie"
        width={260}
        height={140}
        className="object-contain"
        style={{ width: 260, height: "auto" }}
        priority
      />
    </div>
  );
}
