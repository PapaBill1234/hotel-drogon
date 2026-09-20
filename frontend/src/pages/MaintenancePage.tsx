import MaintenanceClassic, { MaintenanceNew } from '../components/MaintenanceTemplates';
import { useMaintenance } from '../hooks/usePublicContent';

/**
 * `maintenance.php` entry point.
 *
 * Legacy behaviour, reproduced from `/api/public/maintenance`:
 *
 *  - `closed === false`  → the PHP `header("Location: " . PATH . "/")` redirect,
 *  - `style === 'new'`   → `require("./maintenance_new.php")`,
 *  - otherwise           → `templates/maintenance_header.php` + classic body.
 *
 * While the flag is in flight nothing is rendered; the classic template is the
 * legacy default because `maintenance_style` defaulted to "0".
 */
export default function MaintenancePage() {
  const { data, isLoading } = useMaintenance();

  if (isLoading) return null;

  if (data && data.closed === false) {
    return (
      <>
        <title>PHPRetro</title>
        <p>
          The hotel is open. <a href="/">Continue to the frontpage</a>.
        </p>
      </>
    );
  }

  if (data?.style === 'new') {
    return <MaintenanceNew showTwitter={data.show_twitter} />;
  }

  return <MaintenanceClassic />;
}
