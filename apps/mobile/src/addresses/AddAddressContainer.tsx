import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/runtime';
import { MY_OUTAGES_KEY, SUBSCRIPTIONS_KEY } from '../home/useHomeData';
import { useGazetteer } from '../gazetteer/cache';
import { useAddresses } from '../store/addresses';
import { useSettings } from '../store/settings';
import { AddAddressForm } from './AddAddressForm';
import { saveAddress } from './save';

/** The add-address form wired to the real gazetteer cache, the API and the list on the device. */
export function AddAddressContainer({
  onSaved,
  initial,
}: {
  onSaved: () => void;
  initial?: { kind: 'street' | 'settlement'; id: number };
}) {
  const { index, status, retry } = useGazetteer('nis');
  const script = useSettings((s) => s.script);
  const queryClient = useQueryClient();
  const existingCount = useAddresses((s) => s.items.length);
  return (
    <AddAddressForm
      index={index}
      indexStatus={status}
      onRetryIndex={retry}
      script={script}
      existingCount={existingCount}
      save={async (request) => {
        const saved = await saveAddress(api, request);
        // Početna shows the new address and the outages already published for it.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
          queryClient.invalidateQueries({ queryKey: MY_OUTAGES_KEY }),
        ]);
        return saved;
      }}
      onSaved={onSaved}
      initial={initial}
    />
  );
}
