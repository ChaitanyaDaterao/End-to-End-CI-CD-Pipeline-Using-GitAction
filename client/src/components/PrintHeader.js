import React from 'react';
import { COMPANY_LOGO } from '../utils/printHelper';

// Place this component at the very top of any bill section/modal
// It is invisible on screen but appears at top of every printed page
export default function PrintHeader() {
  return (
    <>
      <style>{`
        @media print {
          .rc-screen-hide { display: none !important; }
          .rc-print-header-block {
            display: block !important;
            text-align: center;
            margin-bottom: 18px;
            padding-bottom: 14px;
            border-bottom: 3px solid #222;
            page-break-after: avoid;
          }
          .rc-print-header-block img {
            height: 80px;
            width: auto;
            display: block;
            margin: 0 auto 6px;
          }
          .rc-print-header-block h2 {
            font-size: 20px;
            font-weight: 800;
            color: #111;
            margin: 0;
          }
          .rc-print-header-block p.owners {
            margin: 3px 0 0;
            font-size: 12px;
            color: #444;
          }
          .rc-dev-footer-block {
            display: block !important;
            margin-top: 30px;
            padding-top: 10px;
            border-top: 1px solid #ccc;
            text-align: center;
          }
          .rc-dev-footer-block p {
            font-size: 9px;
            color: #aaa;
          }
        }
        /* Hidden on screen */
        .rc-print-header-block { display: none; }
        .rc-dev-footer-block { display: none; }
      `}</style>

      <div className="rc-print-header-block" data-print-header="true">
        <img src={COMPANY_LOGO} alt="RC Enterprises" />
        <h2>R.C Enterprises</h2>
        <p className="owners">Mr. Chand Laluwale &nbsp;|&nbsp; Mr. Roshan Laluwale</p>
      </div>
    </>
  );
}

export function PrintFooter() {
  return (
    <div className="rc-dev-footer-block" data-print-footer="true">
      <p>Developed by Chaitanya H Daterao &nbsp;&nbsp;|&nbsp;&nbsp; Mob: 9766150846</p>
    </div>
  );
}
