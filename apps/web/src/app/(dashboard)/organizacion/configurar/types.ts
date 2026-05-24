export type Organization = {
  id: string;
  name: string;
  type: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
  dependence: string | null;
};

export type Grade = {
  id: string;
  name: string;
  shortName: string;
  code: string;
  cycle: number;
  order: number;
};

export type Subject = {
  id: string;
  name: string;
  shortName: string;
  code: string;
  minedlucCode: string | null;
};
