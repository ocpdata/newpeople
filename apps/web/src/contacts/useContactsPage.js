import { useContactOpportunities } from "./useContactOpportunities";
import { useContactsCrud } from "./useContactsCrud";

export function useContactsPage({ currentUser, searchParams, setSearchParams }) {
  const crud = useContactsCrud({ currentUser, searchParams, setSearchParams });
  const opportunities = useContactOpportunities();

  return {
    ...crud,
    ...opportunities,
  };
}