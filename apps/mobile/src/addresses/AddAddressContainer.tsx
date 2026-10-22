import { api } from '../api/runtime';
import { useGazetteer } from '../gazetteer/cache';
import { useAddresses } from '../store/addresses';
import { useSettings } from '../store/settings';
import { AddAddressForm } from './AddAddressForm';
import { saveAddress } from './save';

/** The add-address form wired to the real gazetteer cache, the API and the list on the device. */
export function AddAddressContainer({ onSaved }: { onSaved: () => void }) {
  const { index, status, retry } = useGazetteer('nis');
  const script = useSettings((s) => s.script);
  const existingCount = useAddresses((s) => s.items.length);
  return (
    <AddAddressForm
      index={index}
      indexStatus={status}
      onRetryIndex={retry}
      script={script}
      existingCount={existingCount}
      save={(request) => saveAddress(api, request)}
      onSaved={onSaved}
    />
  );
}
