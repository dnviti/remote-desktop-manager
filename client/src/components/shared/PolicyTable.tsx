import type { ReactNode } from "react";
import { Edit3, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PolicyTableColumn<T> {
  id: string;
  header: string;
  className?: string;
  headerClassName?: string;
  cell: (item: T) => ReactNode;
}

interface PolicyTableProps<T> {
  ariaLabel: string;
  items: T[];
  columns: PolicyTableColumn<T>[];
  emptyTitle: string;
  emptyDescription: string;
  getKey: (item: T, index: number) => string;
  getRowLabel: (item: T) => string;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
}

export default function PolicyTable<T>({
  ariaLabel,
  items,
  columns,
  emptyTitle,
  emptyDescription,
  getKey,
  getRowLabel,
  onEdit,
  onDelete,
}: PolicyTableProps<T>) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/15 px-4 py-8 text-center">
        <div className="text-sm font-semibold text-foreground">
          {emptyTitle}
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/70">
      <Table aria-label={ariaLabel}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id} className={column.headerClassName}>
                {column.header}
              </TableHead>
            ))}
            <TableHead className="w-[3.5rem] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => {
            const rowLabel = getRowLabel(item);

            return (
              <TableRow key={getKey(item, index)}>
                {columns.map((column) => (
                  <TableCell key={column.id} className={column.className}>
                    {column.cell(item)}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Open actions for ${rowLabel}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(item)}>
                        <Edit3 />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
