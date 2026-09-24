import { auth } from "@clerk/nextjs/server";
import { SearchPageClient } from "@/components/search/SearchPageClient";

export default async function SearchPage() {
  await auth.protect();
  return <SearchPageClient />;
}
