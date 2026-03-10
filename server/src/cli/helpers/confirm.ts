 

export function requireConfirm(
  confirmed: boolean | undefined,
  summary: string,
): boolean {
  if (!confirmed) {
    console.log(summary);
    console.log('\nPass --confirm to execute this operation.');
    return false;
  }
  return true;
}
