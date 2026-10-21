import { SessionPhotos } from "../../features/listings/components/SessionPhotos";
export default function ListingsLayout({ children }: { children: React.ReactNode }) {
  return <SessionPhotos>{children}</SessionPhotos>;
}
