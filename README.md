# RAB Rumah Kos Puri

Construction-budget dashboard using **Google Sheets for records** and **Google Drive for receipts**. The Next.js interface runs on Vercel, with Google Apps Script connecting it to your spreadsheet and receipt folder.

## One-time Google setup

1. Open https://script.google.com and create a **New project** named `RAB Puri`.
2. Replace `Code.gs` with the contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
3. To import the saved categories and budgets, add a second Script file named `MigrationData` and paste the contents of the local **`migration/MigrationData.gs`** file. This private seed file is excluded from Git. For a fresh setup without it, add your categories directly to the spreadsheet after running setup.
4. Select **setupGoogleStorage** in the function dropdown and click **Run**. Authorize access to your Sheets and Drive. It creates the spreadsheet and receipt folder and imports missing rows. Running it again preserves existing rows and budgets.
5. The execution log shows the spreadsheet and folder links. In **Project Settings > Script Properties**, find `API_SECRET`. Keep this secret private.
6. Click **Deploy > New deployment > Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then deploy. The web endpoint requires the secret for every data operation; the spreadsheet and folder themselves remain private. Copy the deployment URL ending in `/exec`.
7. Configure these **server-only** environment variables locally in `.env.local` and in **Vercel > Project Settings > Environment Variables**:

   ```dotenv
   GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   GOOGLE_SCRIPT_SECRET=the_API_SECRET_from_Script_Properties
   ```

   Never prefix these with `NEXT_PUBLIC_`. These are the only connection variables required by the app.
8. Restart local development or deploy the updated source to Vercel. Verify your categories and budgets, save a small test payment with a receipt, and open its receipt link.

Google must authorize the script in the account that owns the files. Connecting Google Drive in chat may help with file preparation, but it does not replace authorizing and deploying this Apps Script web app. Organization-managed Google accounts may restrict deployments accessible to Anyone; a personal account is often simpler for this small project.

When changing the Apps Script code later, use **Deploy > Manage deployments > Edit > New version > Deploy** to update the existing deployment and preserve its URL.

## Everyday use

- **Dashboard:** budget, spending, remaining balance, and stage progress.
- **Input Realisasi:** choose a stage, enter the date and amount, and optionally attach one receipt.
- **Laporan:** view saved payments, open receipt links, or delete a report. Original receipts stay in Drive as an archive after deleting a report.
- **/admin > Budget:** edit a budget and click Save.
- To add a stage, open the spreadsheet's `categories` tab and add a row with a unique ID, unique name, and nonnegative whole-rupiah budget. Use **Muat ulang** or refresh the dashboard afterward. Preserve the header row and existing IDs and names; payment rows refer to stage names.

Share the receipt **folder** in Google Drive with the family or team members who need to view receipts. Receipts are not automatically public; viewers may need to sign into the Google account granted access. Keep spreadsheet editor access limited to the people maintaining budgets.

The dashboard retains its existing access model: anyone who can open its URL can read and submit reports, delete reports, and call the budget API. `/admin` is a separate editing screen, not an authentication boundary. The script secret protects the Google backend from direct calls; it is not a visitor login. Use this only with the intended trusted audience; add application authentication before using it for restricted records or public submissions.

## Attachments and reliability

JPG, PNG, and WebP photos up to **10 MB** are accepted; photos larger than 3 MB are resized in the browser before upload. PDF and HEIC/HEIF must be **3 MB or smaller**. This keeps the Vercel request below its 4.5 MB limit. One receipt is supported per payment.

A payment and its receipt are saved together by Apps Script. The client retains a unique request ID after a failed save; retrying the same submission returns an existing payment instead of adding it twice. Script locks serialize writes. Invalid categories, dates, amounts, and attachment types are rejected. Text is stored literally so entered spreadsheet formulas are not executed.

The spreadsheet is easy to inspect and export. Google storage and Apps Script quotas still apply; this is intended for a small team, not high-volume transactions. Keep regular spreadsheet exports as backups. Free-service terms can change.

## Development and checks

```sh
npm install
npm run dev
npm test
npm run build
```

The test suite exercises the actual Apps Script with in-memory Sheets/Drive substitutes and the API route with a simulated Google endpoint. It does not modify a live Google account. `google-apps-script/appsscript.json` is provided for optional use with Apps Script's manifest editor or clasp.

## Deployment

Set `GOOGLE_SCRIPT_URL` and `GOOGLE_SCRIPT_SECRET` for the Production environment in Vercel. With the Git integration enabled, pushing to the project's production branch triggers a production deployment. This checkout currently uses `master`; verify the production branch in Vercel before pushing. The new source code must be deployed for the Google connection to take effect.

Never commit `.env.local`, API secrets, or the private files in `migration/`. The private seed contains 13 categories and their budgets; a local JSON backup is retained alongside it. No live database or export service is required to use this seed.

## Troubleshooting

- **Google storage not connected:** set both server environment variables, then restart or redeploy.
- **Google connection not ready:** use the `/exec` deployment URL, run the setup function, and verify the web app executes as you with Anyone access.
- **Connection key mismatch:** match Vercel's `GOOGLE_SCRIPT_SECRET` to the script property `API_SECRET`. Redeploy after changing Vercel values.
- **Empty dropdown:** check the `categories` sheet and preserve its exact `id`, `name`, `budget` headers. Add actual project stages or include the migration file before setup.
- **Receipt access denied:** share the folder with that viewer's Google account.
- **Google quota or storage error:** check available Drive storage and the script's Executions page; retry after the quota resets. The form retains entered values and the chosen file.

References: [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [Content Service redirects](https://developers.google.com/apps-script/guides/content), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [Google storage](https://support.google.com/drive/answer/9312312), [Vercel payload limit](https://vercel.com/docs/functions/limitations#request-body-size).
